import datetime
import datetime as _dt
import stripe
from django.conf import settings
from django.core.signing import TimestampSigner, SignatureExpired, BadSignature
from django.utils import timezone
from django.utils import timezone as _tz
from django.core.mail import send_mail
from django.core.cache import cache
from django.db.models import Sum
from django.db import transaction, IntegrityError
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import generics, permissions, serializers, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.tokens import RefreshToken
from .models import Marina, User, MagicToken, EmailVerification
from .serializers import MarinaSerializer, UserSerializer, UserInviteSerializer, DocksBaseTokenSerializer, SendMagicLinkSerializer, ExchangeMagicTokenSerializer, SignupSerializer, DraftAccountSerializer
from .emails import send_verification_email, send_welcome_email
from apps.members.models import Member
from apps.billing.service import seed_default_tax_rates
from config.plans import PRICE_ID_TO_PLAN, ENTERPRISE_ADDON_MARINA_PRICE_ID

stripe.api_key = getattr(settings, 'STRIPE_SECRET_KEY', '')


class SignupView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        ser = SignupSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data

        with transaction.atomic():
            marina = Marina.objects.create(
                name=d['marina_name'],
                status='trial',
                plan='professional',
                trial_ends=datetime.date.today() + datetime.timedelta(days=30),
            )
            seed_default_tax_rates(marina)
            try:
                user = User.objects.create_user(
                    email=d['email'],
                    password=d['password'],
                    first_name=d['first_name'],
                    last_name=d['last_name'],
                    role='owner',
                    is_active=False,
                    marina=marina,
                )
            except IntegrityError:
                raise serializers.ValidationError({'email': ['A user with this email already exists.']})
            ev = EmailVerification.objects.create(user=user)

        send_verification_email(user, ev.token)
        return Response(
            {'detail': 'Check your email to confirm your account.'},
            status=status.HTTP_201_CREATED,
        )


class VerifyEmailView(APIView):
    permission_classes = [permissions.AllowAny]

    # FIX 6: changed from GET (token in query param) to POST (token in request body)
    def post(self, request):
        token = request.data.get('token')
        if not token:
            return Response({'detail': 'Invalid or expired link.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            ev = EmailVerification.objects.select_related('user').get(token=token)
        except (EmailVerification.DoesNotExist, ValueError):
            return Response({'detail': 'Invalid or expired link.'}, status=status.HTTP_400_BAD_REQUEST)

        if timezone.now() - ev.created_at > datetime.timedelta(hours=24):
            ev.delete()
            return Response({'detail': 'Invalid or expired link.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            user = ev.user
            user.is_active = True
            user.save(update_fields=['is_active'])
            ev.delete()

        refresh = RefreshToken.for_user(user)
        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'user': UserSerializer(user).data,
        })


class ResendVerificationView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        email = request.data.get('email', '')

        # FIX 7: rate-limit check BEFORE user lookup to prevent user enumeration.
        # Both real and non-existent email addresses receive the same 200 response.
        cache_key = f'resend_verification:{email}'
        if cache.get(cache_key):
            # Return the same success-shaped response regardless so attackers
            # cannot distinguish rate-limited real users from unknown emails.
            return Response({'detail': 'Verification email resent.'}, status=status.HTTP_200_OK)
        cache.set(cache_key, True, timeout=60)

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            # Unknown email — silently succeed to avoid enumeration
            return Response({'detail': 'Verification email resent.'})

        if user.is_active:
            return Response({'detail': 'Verification email resent.'})

        EmailVerification.objects.filter(user=user).delete()
        ev = EmailVerification.objects.create(user=user)
        send_verification_email(user, ev.token)

        return Response({'detail': 'Verification email resent.'})


class IsMarinaStaff(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in ('owner', 'manager', 'staff')
        )


class OnboardingView(APIView):
    permission_classes = [IsMarinaStaff]
    PROTECTED_KEYS = {'connect_bank', 'invite_staff'}
    ALLOWED_KEYS   = {'draw_map', 'set_pricing'}

    def _get_onboarding(self, marina):
        defaults = {
            'draw_map': False, 'set_pricing': False,
            'connect_bank': False, 'invite_staff': False,
        }
        return {**defaults, **marina.onboarding}

    def get(self, request):
        return Response(self._get_onboarding(request.user.marina))

    def patch(self, request):
        invalid = set(request.data.keys()) & self.PROTECTED_KEYS
        if invalid:
            return Response(
                {'detail': 'connect_bank and invite_staff are controlled by backend signals only.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        marina = request.user.marina
        current = self._get_onboarding(marina)
        for key in self.ALLOWED_KEYS:
            if key in request.data:
                current[key] = bool(request.data[key])
        marina.onboarding = current
        marina.save(update_fields=['onboarding'])
        return Response(current)


class LoginView(TokenObtainPairView):
    serializer_class = DocksBaseTokenSerializer
    permission_classes = [permissions.AllowAny]

    def post(self, request, *args, **kwargs):
        # Run the standard serializer validation (password check, email-not-verified guard).
        # This raises an exception on failure, which DRF turns into the appropriate 400/401.
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = serializer.user  # set by TokenObtainPairSerializer after successful validation

        # Import here to avoid circular imports at module load time.
        from apps.security.services import mfa as mfa_service

        marina = getattr(user, 'marina', None)

        # Case B / C — user has active MFA
        try:
            user_mfa = user.mfa
            has_active_mfa = user_mfa.is_active
        except Exception:
            has_active_mfa = False

        if has_active_mfa:
            # Case C: valid trust cookie → bypass MFA, issue tokens normally
            if mfa_service.is_device_trusted(request, user):
                return _normal_token_response(serializer)

            # Case B: issue challenge, suppress tokens
            challenge = mfa_service.issue_challenge(user, purpose='login')
            return Response({
                'mfa_required': True,
                'mfa_challenge_token': challenge.token,
            })

        # Case D — marina policy requires MFA, user has none (and is owner/manager)
        if (
            marina is not None
            and getattr(marina, 'require_mfa_for_managers', False)
            and getattr(user, 'role', None) in ('owner', 'manager')
        ):
            # Start enrollment (handles all 4 pre-existing states; abandons if needed)
            try:
                _, secret = mfa_service.start_enrollment(user)
            except ValueError:
                # Edge case: user somehow has active MFA already — treat as Case A
                return _normal_token_response(serializer)

            qr_uri = mfa_service.build_totp_uri(user, secret)
            challenge = mfa_service.issue_challenge(user, purpose='enrollment')
            return Response({
                'mfa_enrollment_required': True,
                'mfa_enrollment_token': challenge.token,
                'mfa_secret': secret,
                'mfa_qr_uri': qr_uri,
            })

        # Case A — no MFA, no marina policy: issue tokens normally
        return _normal_token_response(serializer)


def _normal_token_response(serializer):
    """Return the standard {access, refresh, user} response from a validated serializer."""
    return Response(serializer.validated_data)


class MarinaProfileView(generics.RetrieveUpdateAPIView):
    serializer_class = MarinaSerializer

    def get_object(self):
        return self.request.user.marina


class MarinaUsersView(generics.ListAPIView):
    serializer_class = UserSerializer

    def get_queryset(self):
        return User.objects.filter(marina=self.request.user.marina)


class InviteUserView(generics.CreateAPIView):
    serializer_class = UserInviteSerializer

    def get_queryset(self):
        return User.objects.filter(marina=self.request.user.marina)

    # FIX 8: after the serializer creates the inactive user, generate a password-setup
    # link and email it to the invited address.
    def perform_create(self, serializer):
        user = serializer.save()
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        link = f"{settings.FRONTEND_URL}/setup-account?uid={uid}&token={token}"
        try:
            send_mail(
                subject="You've been invited to DocksBase",
                message=(
                    f"Hi {user.first_name or user.email},\n\n"
                    f"You've been invited to join {user.marina.name} on DocksBase.\n\n"
                    f"Click the link below to set your password and activate your account:\n{link}\n\n"
                    "DocksBase"
                ),
                from_email=None,
                recipient_list=[user.email],
            )
        except Exception:
            # Don't roll back the user creation — the admin can resend manually
            pass


class UserDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = UserSerializer

    def get_queryset(self):
        return User.objects.filter(marina=self.request.user.marina)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        update_fields = []
        if 'is_active' in request.data and instance.role != 'owner':
            instance.is_active = bool(request.data['is_active'])
            update_fields.append('is_active')
        if 'module_permissions' in request.data and isinstance(request.data['module_permissions'], dict):
            instance.module_permissions = request.data['module_permissions']
            update_fields.append('module_permissions')
        if update_fields:
            instance.save(update_fields=update_fields)
        return Response(UserSerializer(instance).data)


class MeView(generics.RetrieveAPIView):
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user


class MarinaOverviewView(APIView):
    permission_classes = [IsMarinaStaff]

    def get(self, request):
        marina = request.user.marina
        today = datetime.date.today()

        # Arrivals today
        arrivals_today = marina.bookings.filter(
            check_in=today,
            status__in=['confirmed', 'checked_in', 'pending'],
        ).count()

        # Pending payments (open invoices)
        open_invoices = marina.invoices.filter(status='open')
        pending_payments_count = open_invoices.count()
        pending_payments_amount = float(
            open_invoices.aggregate(t=Sum('total'))['t'] or 0
        )
        overdue_count = open_invoices.filter(due_date__lt=today).count()

        # Open tasks
        open_tasks_qs = marina.tasks.filter(done=False)
        open_tasks_count = open_tasks_qs.count()
        high_priority_count = open_tasks_qs.filter(priority='high').count()
        unassigned_count = open_tasks_qs.filter(assigned_to='').count()

        # Urgent alerts
        urgent = []
        for inv in open_invoices.filter(due_date__lt=today).select_related('member').order_by('due_date')[:5]:
            name = inv.member.name if inv.member else 'Unknown'
            days = (today - inv.due_date).days
            urgent.append({
                'severity': 'red',
                'text': f'{name} — {inv.invoice_number} overdue {days}d. €{inv.total}',
            })
        for inc in marina.incidents.filter(resolved=False, severity='critical').order_by('-occurred_at')[:3]:
            urgent.append({'severity': 'red', 'text': f'INC-{inc.pk} (critical): {inc.description[:80]}'})
        for inc in marina.incidents.filter(resolved=False, severity='high').order_by('-occurred_at')[:3]:
            urgent.append({'severity': 'orange', 'text': f'INC-{inc.pk}: {inc.description[:80]}'})

        # Recent activity — merge bookings, invoices, tasks, incidents sorted by time
        activity = []
        for b in marina.bookings.select_related('vessel', 'berth').order_by('-created_at')[:6]:
            vessel = b.vessel.name if b.vessel else (b.guest_name or 'Unknown')
            berth = b.berth.code if b.berth else '?'
            if b.status == 'checked_in':
                text, color = f'{vessel} checked in to {berth}', '#38a860'
            elif b.status == 'checked_out':
                text, color = f'{vessel} departed {berth}', '#b8965a'
            elif b.status in ('confirmed', 'awaiting_payment', 'pending_payment'):
                text, color = f'Booking BK-{b.pk} confirmed — {vessel}', '#38a860'
            else:
                text, color = f'New booking BK-{b.pk} — {vessel}', '#3a7fc8'
            activity.append({'text': text, 'color': color, 'ts': b.created_at.isoformat()})
        for inv in marina.invoices.order_by('-created_at')[:4]:
            if inv.status == 'paid' and inv.paid_at:
                activity.append({'text': f'Invoice {inv.invoice_number} marked paid', 'color': '#3a7fc8', 'ts': inv.paid_at.isoformat()})
            elif inv.status in ('open', 'draft'):
                activity.append({'text': f'Invoice {inv.invoice_number} created', 'color': '#3a7fc8', 'ts': inv.created_at.isoformat()})
        for t in marina.tasks.order_by('-created_at')[:3]:
            activity.append({'text': f'Task: {t.text[:60]}', 'color': '#e08020', 'ts': t.created_at.isoformat()})
        for i in marina.incidents.order_by('-created_at')[:2]:
            activity.append({'text': f'Incident: {i.description[:60]}', 'color': '#c04040', 'ts': i.created_at.isoformat()})
        activity.sort(key=lambda x: x['ts'], reverse=True)

        return Response({
            'arrivals_today': arrivals_today,
            'pending_payments_count': pending_payments_count,
            'pending_payments_amount': pending_payments_amount,
            'overdue_count': overdue_count,
            'open_tasks_count': open_tasks_count,
            'high_priority_count': high_priority_count,
            'unassigned_count': unassigned_count,
            'urgent_alerts': urgent[:6],
            'recent_activity': activity[:8],
        })


class SendMagicLinkView(APIView):
    permission_classes = [IsMarinaStaff]
    """Admin/manager sends a magic login link to a boater (Member)."""

    def post(self, request):
        ser = SendMagicLinkSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        try:
            member = Member.objects.get(
                id=ser.validated_data['member_id'],
                marina=request.user.marina,
            )
        except Member.DoesNotExist:
            return Response({'detail': 'Member not found.'}, status=status.HTTP_404_NOT_FOUND)

        if not member.email:
            return Response({'detail': 'Member has no email address.'}, status=status.HTTP_400_BAD_REQUEST)

        # Find or create boater User linked to this Member
        if member.boater_user_id:
            boater_user = member.boater_user
        else:
            boater_user, _ = User.objects.get_or_create(
                email=member.email,
                defaults={
                    'role': 'boater',
                    'first_name': member.name.split()[0] if member.name else '',
                    'marina': request.user.marina,
                },
            )
            if not member.boater_user_id:
                member.boater_user = boater_user
                member.save(update_fields=['boater_user'])

        # Ensure this user has boater role regardless of how they were found
        if boater_user.role != 'boater':
            boater_user.role = 'boater'
            boater_user.save(update_fields=['role'])

        # Delete all existing tokens — only newest link is valid
        MagicToken.objects.filter(user=boater_user).delete()

        magic = MagicToken.objects.create(
            user=boater_user,
            # FIX 2: reduced expiry from 7 days to 1 hour
            expires_at=timezone.now() + datetime.timedelta(hours=1),
        )

        # FIX 1: use settings.FRONTEND_URL instead of the attacker-controlled Origin header
        link = f"{settings.FRONTEND_URL}/magic?token={magic.token}"

        try:
            send_mail(
                subject='Your DockBase portal link',
                message=f"Hi {member.name},\n\nClick to access your marina portal (valid 1 hour):\n{link}\n\nDockBase",
                from_email=None,
                recipient_list=[member.email],
            )
        except Exception:
            magic.delete()
            return Response(
                {'detail': 'Could not send email. Please try again.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response({'detail': 'Link sent.'}, status=status.HTTP_200_OK)


class ExchangeMagicTokenView(APIView):
    """Boater exchanges a one-time token for a JWT pair."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        ser = ExchangeMagicTokenSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        try:
            magic = MagicToken.objects.select_related('user').get(
                token=ser.validated_data['token'],
                expires_at__gt=timezone.now(),
            )
        except MagicToken.DoesNotExist:
            return Response({'detail': 'Invalid or expired link.'}, status=status.HTTP_400_BAD_REQUEST)

        user = magic.user
        magic.delete()  # single-use

        refresh = RefreshToken.for_user(user)
        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'user': UserSerializer(user).data,
        })


class ConnectOnboardView(APIView):
    """Start (or restart) Stripe Express onboarding for a marina."""
    permission_classes = [IsMarinaStaff]

    def post(self, request):
        marina = request.user.marina

        if not marina.stripe_account_id:
            account = stripe.Account.create(
                type='express',
                email=marina.contact_email or request.user.email,
                capabilities={
                    'card_payments': {'requested': True},
                    'transfers': {'requested': True},
                },
                metadata={'marina_id': str(marina.id)},
            )
            marina.stripe_account_id = account.id
            marina.save(update_fields=['stripe_account_id'])

        link = stripe.AccountLink.create(
            account=marina.stripe_account_id,
            refresh_url=f'{settings.FRONTEND_URL}/settings/payments?connect=refresh',
            return_url=f'{settings.FRONTEND_URL}/settings/payments?connect=done',
            type='account_onboarding',
        )
        return Response({'url': link.url})


class ConnectStatusView(APIView):
    """Return Stripe Connect status and Express dashboard link for the marina."""
    permission_classes = [IsMarinaStaff]

    def get(self, request):
        marina = request.user.marina

        if not marina.stripe_account_id:
            return Response({'connected': False, 'charges_enabled': False, 'dashboard_url': None})

        account = stripe.Account.retrieve(marina.stripe_account_id)
        dashboard_url = None
        if account.charges_enabled and account.type == 'express':
            try:
                login_link = stripe.Account.create_login_link(marina.stripe_account_id)
                dashboard_url = login_link.url
            except stripe.error.StripeError:
                pass

        return Response({
            'connected': bool(account.details_submitted),
            'charges_enabled': bool(account.charges_enabled),
            'dashboard_url': dashboard_url,
        })


class DraftAccountView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        ser = DraftAccountSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        d = ser.validated_data
        email = d['email']

        # Idempotency: return existing client_secret for pending_payment accounts
        existing_user = User.objects.filter(email=email).select_related('marina').first()
        if existing_user:
            if existing_user.marina and existing_user.marina.status == 'pending_payment':
                sub = stripe.Subscription.retrieve(
                    existing_user.marina.stripe_subscription_id,
                    expand=['pending_setup_intent'],
                )
                return Response(
                    {'client_secret': sub.pending_setup_intent.client_secret},
                    status=status.HTTP_201_CREATED,
                )
            if not existing_user.is_active:
                return Response(
                    {'code': 'email_not_verified', 'detail': 'Please verify your email before continuing.'},
                    status=status.HTTP_409_CONFLICT,
                )
            raise serializers.ValidationError({'email': ['An account with this email already exists.']})

        with transaction.atomic():
            marina = Marina.objects.create(
                name=d['marina_name'],
                address=d['address'],
                lat=d.get('lat'),
                lng=d.get('lng'),
                phone=d['phone'],
                contact_email=d['contact_email'],
                vat_number=d.get('vat_number', ''),
                currency=d['currency'],
                status='pending_payment',
            )
            seed_default_tax_rates(marina)

            User.objects.create_user(
                email=email,
                password=d['password'],
                first_name=d['first_name'],
                last_name=d['last_name'],
                role='owner',
                marina=marina,
                is_active=False,
            )

            customer = stripe.Customer.create(
                email=email,
                name=d['marina_name'],
                metadata={'marina_id': str(marina.id)},
            )
            marina.stripe_customer_id = customer.id

            items = [{'price': d['plan_price_id']}]
            extra_marinas = d.get('marina_count', 1) - 1
            if extra_marinas > 0 and ENTERPRISE_ADDON_MARINA_PRICE_ID:
                items.append({'price': ENTERPRISE_ADDON_MARINA_PRICE_ID, 'quantity': extra_marinas})

            subscription = stripe.Subscription.create(
                customer=customer.id,
                items=items,
                payment_behavior='default_incomplete',
                trial_period_days=30,
                expand=['pending_setup_intent'],
                metadata={'marina_id': str(marina.id)},
            )
            marina.stripe_subscription_id = subscription.id
            marina.plan = PRICE_ID_TO_PLAN.get(d['plan_price_id'], 'professional')
            marina.save(update_fields=['stripe_customer_id', 'stripe_subscription_id', 'plan'])

        return Response(
            {'client_secret': subscription.pending_setup_intent.client_secret},
            status=status.HTTP_201_CREATED,
        )


class ResumeView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        token = request.data.get('token', '')
        signer = TimestampSigner()
        try:
            marina_id = signer.unsign(token, max_age=172800)  # 48 hours
        except (SignatureExpired, BadSignature):
            return Response({'detail': 'Invalid or expired link.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            marina = Marina.objects.get(pk=marina_id, status='pending_payment')
        except Marina.DoesNotExist:
            return Response({'detail': 'Invalid or expired link.'}, status=status.HTTP_400_BAD_REQUEST)

        sub = stripe.Subscription.retrieve(
            marina.stripe_subscription_id,
            expand=['pending_setup_intent'],
        )
        return Response({
            'client_secret': sub.pending_setup_intent.client_secret,
            'marina_name':   marina.name,
            'plan':          marina.plan,
        })


class GrantSupportAccessView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def _get_marina(self, request):
        if not request.user.marina:
            return None
        return request.user.marina

    def post(self, request):
        if request.user.role != 'owner':
            return Response({'detail': 'Only marina owners can grant support access.'}, status=status.HTTP_403_FORBIDDEN)
        marina = self._get_marina(request)
        if not marina:
            return Response({'detail': 'No marina found.'}, status=status.HTTP_400_BAD_REQUEST)
        marina.support_access_granted_until = _tz.now() + _dt.timedelta(hours=48)
        marina.save(update_fields=['support_access_granted_until'])
        return Response({
            'support_access_granted_until': marina.support_access_granted_until.isoformat(),
        })

    def delete(self, request):
        if request.user.role != 'owner':
            return Response({'detail': 'Only marina owners can revoke support access.'}, status=status.HTTP_403_FORBIDDEN)
        marina = self._get_marina(request)
        if not marina:
            return Response({'detail': 'No marina found.'}, status=status.HTTP_400_BAD_REQUEST)
        marina.support_access_granted_until = None
        marina.save(update_fields=['support_access_granted_until'])
        return Response({'support_access_granted_until': None})


class DropboxSignSettingsView(APIView):
    permission_classes = [IsMarinaStaff]

    def get(self, request):
        marina = request.user.marina
        key = marina.dropboxsign_api_key or ''
        return Response({
            'connected': bool(key and marina.dropboxsign_client_id),
            'client_id': marina.dropboxsign_client_id or '',
            'api_key_tail': key[-4:] if len(key) >= 4 else '',
        })

    def patch(self, request):
        marina = request.user.marina
        api_key   = request.data.get('api_key', marina.dropboxsign_api_key)
        client_id = request.data.get('client_id', marina.dropboxsign_client_id)
        marina.dropboxsign_api_key   = api_key   or ''
        marina.dropboxsign_client_id = client_id or ''
        marina.save(update_fields=['dropboxsign_api_key', 'dropboxsign_client_id'])
        key = marina.dropboxsign_api_key
        return Response({
            'connected': bool(key and marina.dropboxsign_client_id),
            'client_id': marina.dropboxsign_client_id,
            'api_key_tail': key[-4:] if len(key) >= 4 else '',
        })


# ---------------------------------------------------------------------------
# Simple credential-only integration views — store API key (and optional
# secondary id) on Marina, expose GET/PATCH for the Settings UI.
# ---------------------------------------------------------------------------

class _SingleKeyIntegrationView(APIView):
    """
    Base class for integrations that just hold an API key on the Marina model.
    Subclasses set `key_field` (and optionally `extra_field` for a second
    identifier such as a DocuSign account id).
    """
    permission_classes = [IsMarinaStaff]
    key_field   = None   # str — Marina field name for the API key
    extra_field = None   # optional str — Marina field name for a secondary id

    def _payload(self, marina):
        key = getattr(marina, self.key_field) or ''
        data = {
            'connected':    bool(key) and (
                bool(getattr(marina, self.extra_field) or '') if self.extra_field else True
            ),
            'api_key_tail': key[-4:] if len(key) >= 4 else '',
        }
        if self.extra_field:
            data[self.extra_field] = getattr(marina, self.extra_field) or ''
        return data

    def get(self, request):
        return Response(self._payload(request.user.marina))

    def patch(self, request):
        marina = request.user.marina
        api_key = request.data.get('api_key', getattr(marina, self.key_field))
        setattr(marina, self.key_field, api_key or '')
        update_fields = [self.key_field]
        if self.extra_field:
            extra = request.data.get(self.extra_field, getattr(marina, self.extra_field))
            setattr(marina, self.extra_field, extra or '')
            update_fields.append(self.extra_field)
        marina.save(update_fields=update_fields)
        return Response(self._payload(marina))


class MarineTrafficSettingsView(_SingleKeyIntegrationView):
    """AIS vessel tracking — MarineTraffic API key."""
    key_field = 'marinetraffic_api_key'


class OpenWeatherMapSettingsView(_SingleKeyIntegrationView):
    """OpenWeatherMap API key."""
    key_field = 'openweathermap_api_key'


class DocuSignSettingsView(APIView):
    """
    DocuSign needs more than a single key: Integration Key, API Account Id,
    impersonation User Id, RSA private key, and the account base URL.
    `connected` is true once all five are populated.
    """
    permission_classes = [IsMarinaStaff]

    FIELDS = [
        'docusign_api_key', 'docusign_account_id', 'docusign_user_id',
        'docusign_private_key', 'docusign_base_url',
    ]

    def _payload(self, marina):
        key = marina.docusign_api_key or ''
        priv = marina.docusign_private_key or ''
        return {
            'connected': all(getattr(marina, f) for f in self.FIELDS),
            'api_key_tail':         key[-4:] if len(key) >= 4 else '',
            'docusign_account_id':  marina.docusign_account_id or '',
            'docusign_user_id':     marina.docusign_user_id or '',
            'docusign_base_url':    marina.docusign_base_url or '',
            'private_key_present':  bool(priv),
        }

    def get(self, request):
        return Response(self._payload(request.user.marina))

    def patch(self, request):
        marina = request.user.marina
        update_fields = []
        for field in self.FIELDS:
            if field in request.data:
                value = request.data.get(field) or ''
                # Private key blank on update means "keep existing" so the
                # manager doesn't have to re-paste the whole RSA block.
                if field == 'docusign_private_key' and value == '' and marina.docusign_private_key:
                    continue
                setattr(marina, field, value)
                update_fields.append(field)
        if update_fields:
            marina.save(update_fields=update_fields)
        return Response(self._payload(marina))


# ---------------------------------------------------------------------------
# Marina weather — proxies OpenWeatherMap if the marina has a key configured,
# otherwise falls back to Open-Meteo (no-key public API). 10-minute cache.
# ---------------------------------------------------------------------------

_WEATHER_CACHE_TTL = 60 * 10  # 10 min

_OWM_CONDITIONS = {
    'Clear': 'Clear sky', 'Clouds': 'Cloudy', 'Rain': 'Rain',
    'Drizzle': 'Drizzle', 'Thunderstorm': 'Thunderstorm', 'Snow': 'Snow',
    'Mist': 'Mist', 'Fog': 'Fog', 'Haze': 'Haze', 'Smoke': 'Smoke',
    'Dust': 'Dust', 'Sand': 'Sand', 'Ash': 'Ash', 'Squall': 'Squall',
    'Tornado': 'Tornado',
}

_OPEN_METEO_WMO = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Icy fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
    80: 'Showers', 81: 'Heavy showers', 82: 'Violent showers',
    95: 'Thunderstorm', 96: 'Thunderstorm + hail', 99: 'Thunderstorm + heavy hail',
}


def _deg_to_compass(deg):
    if deg is None:
        return ''
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][round(deg / 45) % 8]


def _fetch_openweathermap(lat, lng, api_key):
    """Returns the canonical weather dict, or raises on failure."""
    import requests
    r = requests.get(
        'https://api.openweathermap.org/data/2.5/weather',
        params={'lat': lat, 'lon': lng, 'units': 'metric', 'appid': api_key},
        timeout=8,
    )
    r.raise_for_status()
    d = r.json()
    main_group = (d.get('weather') or [{}])[0].get('main', '')
    return {
        'temp_c':       round(d['main']['temp']),
        'wind_kn':      round(d['wind']['speed'] * 1.94384),  # m/s -> kn
        'wind_dir':     _deg_to_compass(d['wind'].get('deg')),
        'wave_height_m': None,  # OWM doesn't have wave height
        'condition':    _OWM_CONDITIONS.get(main_group, main_group or 'Unknown'),
        'source':       'openweathermap',
    }


def _fetch_open_meteo(lat, lng):
    import requests
    w = requests.get(
        'https://api.open-meteo.com/v1/forecast',
        params={
            'latitude': lat, 'longitude': lng,
            'current': 'temperature_2m,wind_speed_10m,wind_direction_10m,weathercode',
            'wind_speed_unit': 'kn',
        },
        timeout=8,
    )
    w.raise_for_status()
    cur = w.json()['current']
    wave_height_m = None
    try:
        m = requests.get(
            'https://marine-api.open-meteo.com/v1/marine',
            params={'latitude': lat, 'longitude': lng, 'current': 'wave_height'},
            timeout=8,
        )
        if m.ok:
            wave_height_m = m.json().get('current', {}).get('wave_height')
    except requests.RequestException:
        pass
    return {
        'temp_c':        round(cur['temperature_2m']),
        'wind_kn':       round(cur['wind_speed_10m']),
        'wind_dir':      _deg_to_compass(cur.get('wind_direction_10m')),
        'wave_height_m': wave_height_m,
        'condition':     _OPEN_METEO_WMO.get(cur.get('weathercode'), 'Unknown'),
        'source':        'open-meteo',
    }


class MarinaWeatherView(APIView):
    """
    GET /api/v1/marina/weather/
    Returns current conditions at the marina's lat/lng. Uses OpenWeatherMap
    when the marina has configured an API key; otherwise falls back to the
    free Open-Meteo service. Response is cached for 10 minutes per marina.
    """
    permission_classes = [IsMarinaStaff]

    def get(self, request):
        marina = request.user.marina
        if marina.lat is None or marina.lng is None:
            return Response(
                {'detail': 'Marina location not set. Add lat/lng in Marina Profile.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        owm_key = marina.openweathermap_api_key or ''
        cache_key = f'weather:marina:{marina.pk}:{"owm" if owm_key else "om"}'
        cached = cache.get(cache_key)
        if cached:
            return Response(cached)

        try:
            if owm_key:
                data = _fetch_openweathermap(float(marina.lat), float(marina.lng), owm_key)
            else:
                data = _fetch_open_meteo(float(marina.lat), float(marina.lng))
        except Exception:
            # Last-resort fallback: if OWM failed (bad key, rate limit, etc.),
            # try Open-Meteo so the widget still shows something.
            try:
                data = _fetch_open_meteo(float(marina.lat), float(marina.lng))
            except Exception:
                return Response(
                    {'detail': 'Weather service unavailable.'},
                    status=status.HTTP_502_BAD_GATEWAY,
                )

        data['updated_at'] = timezone.now().isoformat()
        cache.set(cache_key, data, _WEATHER_CACHE_TTL)
        return Response(data)

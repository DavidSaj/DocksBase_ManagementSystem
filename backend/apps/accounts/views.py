import datetime
import stripe
from django.conf import settings
from django.core.signing import TimestampSigner, SignatureExpired, BadSignature
from django.utils import timezone
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
        if account.get('charges_enabled'):
            login_link = stripe.Account.create_login_link(marina.stripe_account_id)
            dashboard_url = login_link.url

        return Response({
            'connected': account.get('details_submitted', False),
            'charges_enabled': account.get('charges_enabled', False),
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
        if existing_user and existing_user.marina and existing_user.marina.status == 'pending_payment':
            sub = stripe.Subscription.retrieve(
                existing_user.marina.stripe_subscription_id,
                expand=['pending_setup_intent'],
            )
            return Response(
                {'client_secret': sub.pending_setup_intent.client_secret},
                status=status.HTTP_201_CREATED,
            )

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

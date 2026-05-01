import datetime
from django.utils import timezone
from django.core.mail import send_mail
from django.core.cache import cache
from django.db import transaction, IntegrityError
from rest_framework import generics, permissions, serializers, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.tokens import RefreshToken
from .models import Marina, User, MagicToken, EmailVerification
from .serializers import MarinaSerializer, UserSerializer, UserInviteSerializer, DocksBaseTokenSerializer, SendMagicLinkSerializer, ExchangeMagicTokenSerializer, SignupSerializer
from .emails import send_verification_email, send_welcome_email
from apps.members.models import Member


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

    def get(self, request):
        token = request.query_params.get('token')
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

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            return Response({'detail': 'Verification email resent.'})

        if user.is_active:
            return Response({'detail': 'Verification email resent.'})

        cache_key = f'resend_verification:{email}'
        if cache.get(cache_key):
            return Response(
                {'detail': 'Please wait 60 seconds before requesting another email.'},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        EmailVerification.objects.filter(user=user).delete()
        ev = EmailVerification.objects.create(user=user)
        send_verification_email(user, ev.token)
        cache.set(cache_key, True, timeout=60)

        return Response({'detail': 'Verification email resent.'})


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


class UserDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = UserSerializer

    def get_queryset(self):
        return User.objects.filter(marina=self.request.user.marina)


class MeView(generics.RetrieveAPIView):
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user


class IsMarinaStaff(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in ('owner', 'manager', 'staff')
        )


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
            expires_at=timezone.now() + datetime.timedelta(days=7),
        )

        frontend_url = request.headers.get('Origin', 'https://app.docksbase.com')
        link = f"{frontend_url}/magic?token={magic.token}"

        try:
            send_mail(
                subject='Your DockBase portal link',
                message=f"Hi {member.name},\n\nClick to access your marina portal (valid 7 days):\n{link}\n\nDockBase",
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

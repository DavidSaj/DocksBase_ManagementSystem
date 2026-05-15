"""
Security app views — Task 1: MFA settings-flow and login-flow endpoints.
                    Task 2: IP allowlist viewset + WhoamiIPView.
"""

from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.serializers import UserSerializer
from apps.security.models import MFABackupCode, MarinaIPAllowlist
from apps.security.permissions import IsMarinaOwner, _client_ip, _ip_in_cidr
from apps.security.serializers import (
    MFADisableSerializer,
    MFAEnrollCompleteSerializer,
    MFALoginEnrollCompleteSerializer,
    MFALoginVerifySerializer,
    MarinaIPAllowlistSerializer,
)
from apps.security.services import mfa as mfa_service


class MFAStatusView(APIView):
    """
    GET /api/v1/security/mfa/
    Returns the current user's MFA enrollment state.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        try:
            user_mfa = user.mfa
            enrolled = user_mfa.is_active
            enrolled_at = user_mfa.enrolled_at
        except Exception:
            enrolled = False
            enrolled_at = None

        remaining = MFABackupCode.objects.filter(user=user, used_at__isnull=True).count()
        return Response({
            'enrolled': enrolled,
            'enrolled_at': enrolled_at,
            'has_backup_codes': remaining > 0,
            'backup_codes_remaining': remaining,
        })


class MFAEnrollStartView(APIView):
    """
    POST /api/v1/security/mfa/start-enrollment/
    Begins the MFA enrollment process. Returns {secret, qr_uri}.
    Does NOT issue any token — the user already has a JWT from the settings flow.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        user = request.user
        try:
            _, secret = mfa_service.start_enrollment(user)
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        qr_uri = mfa_service.build_totp_uri(user, secret)
        return Response({'secret': secret, 'qr_uri': qr_uri})


class MFAEnrollCompleteView(APIView):
    """
    POST /api/v1/security/mfa/complete-enrollment/
    Verifies the first TOTP code. On success, sets enrolled_at and returns
    the 10 backup codes (shown once). User already has a JWT.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        ser = MFAEnrollCompleteSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        code = ser.validated_data['code']
        try:
            mfa, raw_codes = mfa_service.complete_enrollment(user, code)
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'enrolled_at': mfa.enrolled_at,
            'backup_codes': raw_codes,
        })


class MFADisableView(APIView):
    """
    POST /api/v1/security/mfa/disable/
    Disables MFA after password confirmation.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        ser = MFADisableSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            mfa_service.disable_mfa(request.user, ser.validated_data['password'])
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Login-flow endpoints (no JWT required — mid-login only)
# ---------------------------------------------------------------------------

class MFALoginVerifyView(APIView):
    """
    POST /api/v1/auth/token/mfa-verify/
    Consumes an MFA challenge (purpose='login') by verifying a TOTP code or
    backup code. On success, mints and returns a JWT pair.

    Body: {mfa_challenge_token, code, trust_device?}
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        ser = MFALoginVerifySerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        token = ser.validated_data['mfa_challenge_token']
        code = ser.validated_data['code']
        trust_device = ser.validated_data.get('trust_device', False)

        challenge = mfa_service.consume_challenge(token, purpose='login')
        if challenge is None:
            return Response(
                {'detail': 'Invalid, expired, or already used challenge token.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        user = challenge.user

        # Try TOTP first, then backup code
        verified = mfa_service.verify_totp(user, code)
        if not verified:
            verified = mfa_service.consume_backup_code(user, code)

        if not verified:
            mfa_service.record_failed_attempt(challenge)
            return Response(
                {'detail': 'Invalid MFA code.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        mfa_service.mark_challenge_consumed(challenge)

        refresh = RefreshToken.for_user(user)
        response_data = {
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'user': UserSerializer(user).data,
        }
        response = Response(response_data)

        if trust_device:
            mfa_service.mark_device_trusted(response, user)

        return response


class MFALoginEnrollCompleteView(APIView):
    """
    POST /api/v1/auth/token/mfa-enroll-complete/
    Consumes a forced-enrollment challenge (purpose='enrollment'), completes
    MFA enrollment for the bound user, and mints a JWT pair.

    Body: {mfa_enrollment_token, code}
    Returns: {access, refresh, user, backup_codes}
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        ser = MFALoginEnrollCompleteSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        token = ser.validated_data['mfa_enrollment_token']
        code = ser.validated_data['code']

        challenge = mfa_service.consume_challenge(token, purpose='enrollment')
        if challenge is None:
            return Response(
                {'detail': 'Invalid, expired, or already used enrollment token.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        user = challenge.user

        try:
            mfa_obj, raw_codes = mfa_service.complete_enrollment(user, code)
        except ValueError as e:
            mfa_service.record_failed_attempt(challenge)
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        mfa_service.mark_challenge_consumed(challenge)

        refresh = RefreshToken.for_user(user)
        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'user': UserSerializer(user).data,
            'backup_codes': raw_codes,
        })


# ---------------------------------------------------------------------------
# Task 2: IP Allowlist
# ---------------------------------------------------------------------------

class IPAllowlistViewSet(ModelViewSet):
    """
    GET    /api/v1/security/ip-allowlist/        — list entries (owner only)
    POST   /api/v1/security/ip-allowlist/        — add entry (owner only, lockout guard)
    DELETE /api/v1/security/ip-allowlist/<id>/   — remove entry (owner only, unconditional)

    Lockout protection (additive only):
    - POST  → refused with 400 if the caller's current IP would NOT be covered
              by the new full allowlist.  Prevents accidental self-lockout.
    - DELETE → always succeeds for owners, even from outside the current allowlist.
              This is the roaming-owner escape hatch (the endpoint itself is also
              in IPAllowlistPermission's EXEMPT_PATHS, so the IP gate is bypassed).
    """
    serializer_class = MarinaIPAllowlistSerializer
    permission_classes = [permissions.IsAuthenticated, IsMarinaOwner]
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        marina = getattr(self.request.user, 'marina', None)
        if marina is None:
            return MarinaIPAllowlist.objects.none()
        return MarinaIPAllowlist.objects.filter(marina=marina).order_by('-created_at')

    def perform_create(self, serializer):
        marina = self.request.user.marina
        serializer.save(marina=marina, created_by=self.request.user)

    def create(self, request, *args, **kwargs):
        """
        Override create to enforce the additive lockout guard.

        Before saving, check that the caller's current IP would be covered by
        the new full allowlist (existing entries + the new one being added).
        If not, refuse with 400.
        """
        marina = getattr(request.user, 'marina', None)
        if marina is None:
            return Response(
                {'detail': 'No marina associated with this account.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        new_cidr = serializer.validated_data['cidr']
        caller_ip = _client_ip(request)

        # Build the hypothetical full allowlist after adding the new entry
        existing_entries = list(marina.ip_allowlist.all())
        all_cidrs = [e.cidr for e in existing_entries] + [new_cidr]

        if not any(_ip_in_cidr(caller_ip, cidr) for cidr in all_cidrs):
            return Response(
                {
                    'detail': (
                        f'Your current IP ({caller_ip}) would not be covered by the new '
                        'allowlist. Add an entry that covers your current IP first to '
                        'avoid locking yourself out.'
                    ),
                    'code': 'ip_not_allowed',
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)


class WhoamiIPView(APIView):
    """
    GET /api/v1/security/whoami-ip/
    Returns the caller's detected IP address as seen by the server.
    Used by the frontend's IPAllowlistEditor to pre-fill the "Use my current IP" button.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response({'ip': _client_ip(request)})

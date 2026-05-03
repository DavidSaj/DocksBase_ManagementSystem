from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from rest_framework import status as http_status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from apps.billing.account_views import _build_detail

User = get_user_model()


class MyAccountView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        member = getattr(request.user, 'member_profile', None)
        if member is None:
            return Response(
                {'detail': 'No member account linked to this user.'},
                status=http_status.HTTP_403_FORBIDDEN,
            )
        return Response(_build_detail(member))


class ActivatePortalView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        uid      = request.data.get('uid', '')
        token    = request.data.get('token', '')
        password = request.data.get('password', '')

        if not all([uid, token, password]):
            return Response(
                {'detail': 'uid, token, and password are required.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        try:
            user_pk = force_str(urlsafe_base64_decode(uid))
            user = User.objects.get(pk=user_pk)
        except (User.DoesNotExist, ValueError, TypeError):
            # ValueError covers binascii.Error from malformed base64
            return Response(
                {'detail': 'Invalid or expired activation link.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        if not default_token_generator.check_token(user, token):
            return Response(
                {'detail': 'Invalid or expired activation link.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        if user.is_active:
            return Response(
                {'detail': 'This account has already been activated.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        try:
            validate_password(password, user)
        except DjangoValidationError as e:
            return Response({'detail': e.messages}, status=http_status.HTTP_400_BAD_REQUEST)

        user.set_password(password)
        user.is_active = True
        user.save(update_fields=['password', 'is_active'])

        refresh = RefreshToken.for_user(user)
        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
        })

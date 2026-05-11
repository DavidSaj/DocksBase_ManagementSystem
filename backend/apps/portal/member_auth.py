from django.core import signing
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from .member_auth_utils import decode_member_session_token


class PortalMemberUser:
    is_authenticated = True
    is_anonymous = False

    def __init__(self, member_id, marina_slug, email):
        self.member_id = member_id
        self.marina_slug = marina_slug
        self.email = email
        self.pk = member_id  # required by DRF throttling


class PortalMemberAuthentication(BaseAuthentication):
    """Authenticates member portal tokens (salt: portal-member-v1).

    Uses 'MemberBearer <token>' scheme to avoid collision with guest
    'Bearer <token>' tokens on the same api.js instance.
    """

    def authenticate(self, request):
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if not auth_header.startswith('MemberBearer '):
            return None
        token = auth_header[13:]
        try:
            payload = decode_member_session_token(token)
        except signing.BadSignature:
            raise AuthenticationFailed('Invalid or expired member token.')
        return (
            PortalMemberUser(
                member_id=payload['member_id'],
                marina_slug=payload['marina_slug'],
                email=payload['email'],
            ),
            None,
        )

    def authenticate_header(self, request):
        return 'MemberBearer realm="portal"'

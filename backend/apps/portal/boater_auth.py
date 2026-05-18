"""DRF authentication for boater-scoped session tokens.

Uses the `BoaterBearer <token>` scheme so it does not collide with the legacy
`Bearer` (guest) and `MemberBearer` (member) schemes during the deprecation
window. Once those are retired this can move to `Bearer`.
"""
from django.core import signing
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from .boater_session import BoaterUser, decode_boater_session_token


class BoaterTokenAuthentication(BaseAuthentication):
    keyword = 'BoaterBearer'

    def authenticate(self, request):
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if not auth_header.startswith(self.keyword + ' '):
            return None
        token = auth_header[len(self.keyword) + 1:]
        try:
            payload = decode_boater_session_token(token)
        except signing.BadSignature:
            raise AuthenticationFailed('Invalid or expired boater token.')
        return (BoaterUser(email=payload['email']), None)

    def authenticate_header(self, request):
        return f'{self.keyword} realm="portal"'

from django.core import signing
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from .checkin_utils import decode_portal_token


class PortalUser:
    def __init__(self, booking_id, marina_slug, boater_email):
        self.booking_id = booking_id
        self.marina_slug = marina_slug
        self.boater_email = boater_email
        self.is_authenticated = True
        self.pk = booking_id  # required by DRF throttling


class PortalTokenAuthentication(BaseAuthentication):
    def authenticate(self, request):
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if not auth_header.startswith('Bearer '):
            return None
        token = auth_header[7:]
        try:
            payload = decode_portal_token(token)
        except signing.BadSignature:
            raise AuthenticationFailed('Invalid or expired portal token.')
        return (PortalUser(**payload), None)

    def authenticate_header(self, request):
        return 'Bearer realm="portal"'

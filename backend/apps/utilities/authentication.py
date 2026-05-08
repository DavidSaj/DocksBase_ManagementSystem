"""
ForkliftDeviceTokenAuthentication

Custom DRF BaseAuthentication for the dry-stack forklift tablet.

Auth pattern:
  - Header: X-Forklift-Device-Token: <64-char token>
  - Returns (None, token_record) — request.user is None, request.auth is the
    ForkliftDeviceToken instance. Views access request.auth.marina for marina
    scoping.
  - Only apply to forklift-specific ViewSets via authentication_classes override,
    NOT globally — this avoids impacting normal JWT-authenticated endpoints.

Why no user object?
  The forklift tablet is a shared device. The device token authenticates the
  hardware. Individual operator identity is captured per-action via operator_pin
  fields or staff assignment — not via a per-session user context.
"""

from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from django.utils import timezone


class ForkliftDeviceTokenAuthentication(BaseAuthentication):
    """
    Authenticates a request using X-Forklift-Device-Token header.

    Returns (None, token_record) so request.user is None but request.auth
    is the ForkliftDeviceToken instance — views access request.auth.marina.
    Only used on forklift-specific endpoints.
    """

    def authenticate(self, request):
        token_value = request.headers.get('X-Forklift-Device-Token')
        if not token_value:
            return None  # Fall through to next authenticator

        # Import here to avoid circular imports at module load time
        from apps.boatyard.models import ForkliftDeviceToken

        try:
            token = ForkliftDeviceToken.objects.select_related('marina').get(
                token=token_value, is_active=True
            )
        except ForkliftDeviceToken.DoesNotExist:
            raise AuthenticationFailed('Invalid or inactive forklift device token.')

        token.last_used_at = timezone.now()
        token.save(update_fields=['last_used_at'])
        return (None, token)  # No user object — identity is the device

    def authenticate_header(self, request):
        return 'ForkliftDeviceToken'

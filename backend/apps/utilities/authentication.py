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


from django.contrib.auth.hashers import check_password


def _touch_last_used(model, pk, current, field='last_used_at'):
    """
    Throttle last-used-at updates to once per hour to avoid write contention
    on configuration tables under IoT load.
    """
    now = timezone.now()
    if current is None or (now - current).total_seconds() > 3600:
        model.objects.filter(pk=pk).update(**{field: now})


class MeterWebhookAuthentication(BaseAuthentication):
    """
    Authenticates requests bearing an X-Webhook-Key header.
    Lookup is O(1) via the indexed plaintext prefix; verification is
    constant-time via Django's password hashers.
    Returns (None, key_row); request.auth.marina gives the marina.
    """

    def authenticate(self, request):
        plaintext = request.headers.get('X-Webhook-Key')
        if not plaintext:
            return None

        from apps.utilities.models import MarinaMeterWebhookKey

        prefix = plaintext[:MarinaMeterWebhookKey.PREFIX_LEN]
        try:
            row = MarinaMeterWebhookKey.objects.select_related('marina').get(
                key_prefix=prefix, is_active=True,
            )
        except MarinaMeterWebhookKey.DoesNotExist:
            raise AuthenticationFailed('Invalid webhook key.')

        if not row.key_hash or not check_password(plaintext, row.key_hash):
            raise AuthenticationFailed('Invalid webhook key.')

        _touch_last_used(MarinaMeterWebhookKey, row.pk, row.last_used_at)
        return (None, row)

    def authenticate_header(self, request):
        return 'X-Webhook-Key'


class MeterDeviceAuthentication(BaseAuthentication):
    """
    Authenticates requests from a single meter via X-Hardware-ID + X-Device-Token.
    Returns (None, smart_meter); request.auth.marina gives the marina.
    """

    def authenticate(self, request):
        hardware_id = request.headers.get('X-Hardware-ID')
        plaintext   = request.headers.get('X-Device-Token')
        if not hardware_id or not plaintext:
            return None

        from apps.utilities.models import SmartMeter

        try:
            meter = SmartMeter.objects.select_related('marina').get(
                hardware_id=hardware_id, is_active=True,
            )
        except SmartMeter.DoesNotExist:
            raise AuthenticationFailed('Invalid device credentials.')

        if not meter.device_token_hash or not check_password(plaintext, meter.device_token_hash):
            raise AuthenticationFailed('Invalid device credentials.')

        _touch_last_used(SmartMeter, meter.pk, meter.device_token_last_used_at,
                         field='device_token_last_used_at')
        return (None, meter)

    def authenticate_header(self, request):
        return 'X-Hardware-ID, X-Device-Token'

import logging
from django.conf import settings

logger = logging.getLogger(__name__)


def send_sms(to: str, body: str) -> bool:
    """
    Send an SMS via Twilio. Returns True on success, False on any failure.
    Silently no-ops when TWILIO_ACCOUNT_SID is not configured.
    """
    sid = getattr(settings, 'TWILIO_ACCOUNT_SID', '')
    token = getattr(settings, 'TWILIO_AUTH_TOKEN', '')
    from_number = getattr(settings, 'TWILIO_FROM_NUMBER', '')

    if not (sid and token and from_number):
        logger.warning('SMS not configured — skipping send to %s', to)
        return False

    try:
        from twilio.rest import Client
        client = Client(sid, token)
        client.messages.create(body=body, from_=from_number, to=to)
        return True
    except Exception as exc:
        logger.error('SMS send failed to %s: %s', to, exc)
        return False

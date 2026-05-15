import logging
from django.conf import settings

logger = logging.getLogger(__name__)


def _send_twilio(sid: str, token: str, from_number: str, to: str, body: str) -> bool:
    from twilio.rest import Client
    Client(sid, token).messages.create(body=body, from_=from_number, to=to)
    return True


def _send_vonage(api_key: str, api_secret: str, sender: str, to: str, body: str) -> bool:
    import vonage  # type: ignore
    client = vonage.Client(key=api_key, secret=api_secret)
    sms = vonage.Sms(client)
    resp = sms.send_message({'from': sender, 'to': to, 'text': body})
    if resp['messages'][0]['status'] != '0':
        raise RuntimeError(resp['messages'][0].get('error-text', 'Vonage send failed'))
    return True


def _send_messagebird(access_key: str, originator: str, to: str, body: str) -> bool:
    import messagebird  # type: ignore
    messagebird.Client(access_key).message_create(originator, [to], body)
    return True


def send_sms(to: str, body: str, marina=None) -> bool:
    """
    Send an SMS. Prefers per-marina provider credentials when ``marina`` is
    given and ``marina.sms_enabled`` is True; otherwise falls back to the
    platform-default Twilio credentials in settings.

    Returns True on success, False on any failure or when SMS is not configured.
    """
    if marina is not None and getattr(marina, 'sms_enabled', False):
        provider = (marina.sms_provider or 'twilio').lower()
        try:
            if provider == 'twilio' and marina.twilio_account_sid and marina.twilio_auth_token and marina.twilio_from_number:
                return _send_twilio(marina.twilio_account_sid, marina.twilio_auth_token, marina.twilio_from_number, to, body)
            if provider == 'vonage' and marina.vonage_api_key and marina.vonage_api_secret and marina.vonage_from:
                return _send_vonage(marina.vonage_api_key, marina.vonage_api_secret, marina.vonage_from, to, body)
            if provider == 'messagebird' and marina.messagebird_access_key and marina.messagebird_originator:
                return _send_messagebird(marina.messagebird_access_key, marina.messagebird_originator, to, body)
            logger.warning('SMS provider %s not fully configured for marina %s — skipping send to %s', provider, marina.id, to)
            return False
        except Exception as exc:
            logger.error('SMS send via %s failed to %s: %s', provider, to, exc)
            return False

    # Platform-default Twilio fallback
    sid = getattr(settings, 'TWILIO_ACCOUNT_SID', '')
    token = getattr(settings, 'TWILIO_AUTH_TOKEN', '')
    from_number = getattr(settings, 'TWILIO_FROM_NUMBER', '')
    if not (sid and token and from_number):
        logger.warning('SMS not configured — skipping send to %s', to)
        return False
    try:
        return _send_twilio(sid, token, from_number, to, body)
    except Exception as exc:
        logger.error('SMS send failed to %s: %s', to, exc)
        return False

import logging

logger = logging.getLogger(__name__)


def notify_sms(phone: str, message: str) -> None:
    """Stub — replace body with Twilio/Vonage SDK call when provider is chosen."""
    if not phone:
        return
    logger.info('SMS → %s: %s', phone, message)

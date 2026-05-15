import logging
import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class CaptchaInvalid(Exception):
    """Raised when a CAPTCHA token fails verification."""


TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
RECAPTCHA_URL = 'https://www.google.com/recaptcha/api/siteverify'


def verify(token: str, remote_ip: str) -> bool:
    """
    Validate a CAPTCHA token with the configured provider.
    Returns True on success. Raises CaptchaInvalid on any failure.
    Honours CAPTCHA_BYPASS for local dev / tests only.
    """
    if getattr(settings, 'CAPTCHA_BYPASS', False):
        return True

    secret = getattr(settings, 'CAPTCHA_SECRET_KEY', '')
    if not secret:
        logger.error('CAPTCHA_SECRET_KEY not configured')
        raise CaptchaInvalid('captcha_misconfigured')

    if not token:
        raise CaptchaInvalid('captcha_missing')

    provider = getattr(settings, 'CAPTCHA_PROVIDER', 'turnstile')
    url = TURNSTILE_URL if provider == 'turnstile' else RECAPTCHA_URL

    try:
        resp = requests.post(
            url,
            data={'secret': secret, 'response': token, 'remoteip': remote_ip},
            timeout=5,
        )
    except requests.RequestException:
        logger.exception('CAPTCHA verify request failed')
        raise CaptchaInvalid('captcha_unreachable')

    if resp.status_code != 200:
        raise CaptchaInvalid('captcha_http_error')

    data = resp.json()
    if not data.get('success'):
        raise CaptchaInvalid('captcha_rejected')
    return True

import pytest
from unittest.mock import patch
from django.test import override_settings
from apps.common.captcha import verify, CaptchaInvalid


@override_settings(CAPTCHA_BYPASS=True)
def test_bypass_returns_true_with_any_token():
    assert verify('anything', remote_ip='1.2.3.4') is True


@override_settings(CAPTCHA_BYPASS=False, CAPTCHA_PROVIDER='turnstile', CAPTCHA_SECRET_KEY='secret')
def test_verify_calls_turnstile_endpoint_and_returns_true_on_success():
    with patch('apps.common.captcha.requests.post') as p:
        p.return_value.json.return_value = {'success': True}
        p.return_value.status_code = 200
        assert verify('tok', remote_ip='1.2.3.4') is True
        p.assert_called_once()
        args, _ = p.call_args
        assert 'challenges.cloudflare.com' in args[0]


@override_settings(CAPTCHA_BYPASS=False, CAPTCHA_PROVIDER='turnstile', CAPTCHA_SECRET_KEY='secret')
def test_verify_raises_on_provider_failure():
    with patch('apps.common.captcha.requests.post') as p:
        p.return_value.json.return_value = {'success': False, 'error-codes': ['bad']}
        p.return_value.status_code = 200
        with pytest.raises(CaptchaInvalid):
            verify('tok', remote_ip='1.2.3.4')


@override_settings(CAPTCHA_BYPASS=False, CAPTCHA_PROVIDER='turnstile', CAPTCHA_SECRET_KEY='')
def test_verify_raises_when_misconfigured():
    with pytest.raises(CaptchaInvalid):
        verify('tok', remote_ip='1.2.3.4')


@override_settings(CAPTCHA_BYPASS=False, CAPTCHA_PROVIDER='turnstile', CAPTCHA_SECRET_KEY='s')
def test_verify_raises_on_missing_token():
    with pytest.raises(CaptchaInvalid):
        verify('', remote_ip='1.2.3.4')


@override_settings(CAPTCHA_BYPASS=False, CAPTCHA_PROVIDER='recaptcha_v3', CAPTCHA_SECRET_KEY='secret')
def test_verify_calls_recaptcha_endpoint_when_configured():
    with patch('apps.common.captcha.requests.post') as p:
        p.return_value.json.return_value = {'success': True}
        p.return_value.status_code = 200
        assert verify('tok', remote_ip='1.2.3.4') is True
        args, _ = p.call_args
        assert 'recaptcha' in args[0]

"""
QuickBooks Online OAuth2 authorization flow.

Endpoints (all under /api/v1/, mounted from apps/accounting/urls.py):
  GET  /qbo/authorize/   — returns the QBO consent URL the frontend should open
  GET  /qbo/callback/    — QBO redirects here after consent; exchanges code for
                           tokens and upserts AccountingIntegrationConfig.
  POST /qbo/disconnect/  — clears stored credentials and deactivates the config.

State is signed with TimestampSigner (10 min TTL), same pattern as Xero.
"""

import base64
import secrets
from datetime import datetime, timezone as dt_timezone
from urllib.parse import urlencode

import requests
from django.conf import settings
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
from django.shortcuts import redirect
from rest_framework import status
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounting.models import AccountingIntegrationConfig

QBO_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2'
QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'

_STATE_SALT = 'accounting.qbo.oauth'
_STATE_MAX_AGE_SECONDS = 600


def _qbo_configured():
    return bool(settings.QBO_CLIENT_ID and settings.QBO_CLIENT_SECRET and settings.QBO_REDIRECT_URI)


def _sign_state(marina_id: int) -> str:
    payload = f'{marina_id}:{secrets.token_urlsafe(8)}'
    return TimestampSigner(salt=_STATE_SALT).sign(payload)


def _unsign_state(state: str) -> int:
    payload = TimestampSigner(salt=_STATE_SALT).unsign(state, max_age=_STATE_MAX_AGE_SECONDS)
    return int(payload.split(':', 1)[0])


def _redirect_to_settings(connected=False, error=None):
    base = getattr(settings, 'FRONTEND_URL', '') or '/'
    params = {'integration': 'qbo'}
    if connected:
        params['status'] = 'connected'
    if error:
        params['status'] = 'error'
        params['error'] = error
    url = f'{base.rstrip("/")}/settings?tab=system'
    url = f'{url}&{urlencode(params)}'
    return redirect(url)


class QBOAuthorizeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _qbo_configured():
            return Response(
                {'detail': 'QuickBooks Online is not configured on this server. '
                           'QBO_CLIENT_ID, QBO_CLIENT_SECRET, and QBO_REDIRECT_URI must be set.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        marina = request.user.marina
        if marina is None:
            return Response({'detail': 'User is not attached to a marina.'},
                            status=status.HTTP_400_BAD_REQUEST)

        params = {
            'client_id':     settings.QBO_CLIENT_ID,
            'response_type': 'code',
            'redirect_uri':  settings.QBO_REDIRECT_URI,
            'scope':         settings.QBO_SCOPES,
            'state':         _sign_state(marina.pk),
        }
        return Response({'authorize_url': f'{QBO_AUTHORIZE_URL}?{urlencode(params)}'})


class QBOCallbackView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        error = request.GET.get('error')
        if error:
            return _redirect_to_settings(error=request.GET.get('error_description') or error)

        code = request.GET.get('code')
        state = request.GET.get('state')
        realm_id = request.GET.get('realmId') or request.GET.get('realmid')
        if not code or not state or not realm_id:
            return _redirect_to_settings(error='Missing code, state, or realmId.')

        try:
            marina_id = _unsign_state(state)
        except SignatureExpired:
            return _redirect_to_settings(error='Authorization request expired. Try again.')
        except BadSignature:
            return _redirect_to_settings(error='Invalid state.')

        basic = base64.b64encode(
            f'{settings.QBO_CLIENT_ID}:{settings.QBO_CLIENT_SECRET}'.encode()
        ).decode()
        try:
            token_response = requests.post(
                QBO_TOKEN_URL,
                data={
                    'grant_type':   'authorization_code',
                    'code':         code,
                    'redirect_uri': settings.QBO_REDIRECT_URI,
                },
                headers={
                    'Authorization': f'Basic {basic}',
                    'Accept': 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout=15,
            )
        except requests.RequestException as exc:
            return _redirect_to_settings(error=f'QBO token request failed: {exc}')

        if not token_response.ok:
            return _redirect_to_settings(error=f'QBO token exchange failed: {token_response.text[:200]}')

        token = token_response.json()
        access_token = token['access_token']
        refresh_token = token.get('refresh_token', '')
        expires_at = datetime.now(tz=dt_timezone.utc).timestamp() + token.get('expires_in', 3600)

        # Fetch company name as the human-readable label.
        company_name = ''
        try:
            api_base = 'https://sandbox-quickbooks.api.intuit.com' if getattr(settings, 'QBO_SANDBOX', False) \
                else 'https://quickbooks.api.intuit.com'
            info = requests.get(
                f'{api_base}/v3/company/{realm_id}/companyinfo/{realm_id}?minorversion=70',
                headers={'Authorization': f'Bearer {access_token}', 'Accept': 'application/json'},
                timeout=10,
            )
            if info.ok:
                company_name = info.json().get('CompanyInfo', {}).get('CompanyName', '')
        except requests.RequestException:
            pass  # company name is optional

        AccountingIntegrationConfig.objects.update_or_create(
            marina_id=marina_id,
            platform=AccountingIntegrationConfig.Platform.QBO,
            defaults={
                'company_id': realm_id,
                'base_url':   company_name or f'QuickBooks ({realm_id})',
                'is_active':  True,
                'credentials': {
                    'access_token':  access_token,
                    'refresh_token': refresh_token,
                    'expires_at':    expires_at,
                    'client_id':     settings.QBO_CLIENT_ID,
                    'client_secret': settings.QBO_CLIENT_SECRET,
                },
            },
        )
        return _redirect_to_settings(connected=True)


class QBODisconnectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        marina = request.user.marina
        if marina is None:
            return Response({'detail': 'User is not attached to a marina.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            config = AccountingIntegrationConfig.objects.get(
                marina=marina,
                platform=AccountingIntegrationConfig.Platform.QBO,
            )
        except AccountingIntegrationConfig.DoesNotExist:
            return Response({'detail': 'Not connected.'}, status=status.HTTP_404_NOT_FOUND)

        config.credentials = {}
        config.is_active = False
        config.save(update_fields=['credentials', 'is_active'])
        return Response({'detail': 'Disconnected.'})

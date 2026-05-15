"""
Xero OAuth2 authorization flow.

Endpoints (all under /api/v1/, mounted from apps/accounting/urls.py):
  GET  /xero/authorize/         — returns the Xero consent URL the frontend should open
  GET  /xero/callback/          — Xero redirects here after consent; exchanges the
                                  authorization code for tokens, fetches the tenant
                                  list, and upserts AccountingIntegrationConfig.
  POST /xero/disconnect/        — clears stored credentials and deactivates the config.

Security notes:
  - The `state` parameter is signed with the user's marina id and a short-lived
    timestamp. We use Django's signing framework rather than session state so
    the callback works even if the user lands on a different worker.
  - Tokens never leave the backend — only the connected state is exposed via the
    AccountingIntegrationConfigSerializer (which already redacts `credentials`).
"""

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

XERO_AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize'
XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
XERO_CONNECTIONS_URL = 'https://api.xero.com/connections'

_STATE_SALT = 'accounting.xero.oauth'
_STATE_MAX_AGE_SECONDS = 600  # 10 minutes


def _xero_configured():
    return bool(settings.XERO_CLIENT_ID and settings.XERO_CLIENT_SECRET and settings.XERO_REDIRECT_URI)


def _sign_state(marina_id: int) -> str:
    payload = f'{marina_id}:{secrets.token_urlsafe(8)}'
    return TimestampSigner(salt=_STATE_SALT).sign(payload)


def _unsign_state(state: str) -> int:
    payload = TimestampSigner(salt=_STATE_SALT).unsign(state, max_age=_STATE_MAX_AGE_SECONDS)
    return int(payload.split(':', 1)[0])


class XeroAuthorizeView(APIView):
    """Return the Xero consent URL the frontend should open in a popup/new tab."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _xero_configured():
            return Response(
                {'detail': 'Xero is not configured on this server. '
                           'XERO_CLIENT_ID, XERO_CLIENT_SECRET, and XERO_REDIRECT_URI must be set.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        marina = request.user.marina
        if marina is None:
            return Response({'detail': 'User is not attached to a marina.'},
                            status=status.HTTP_400_BAD_REQUEST)

        params = {
            'response_type': 'code',
            'client_id':     settings.XERO_CLIENT_ID,
            'redirect_uri':  settings.XERO_REDIRECT_URI,
            'scope':         settings.XERO_SCOPES,
            'state':         _sign_state(marina.pk),
        }
        return Response({'authorize_url': f'{XERO_AUTHORIZE_URL}?{urlencode(params)}'})


class XeroCallbackView(APIView):
    """
    Xero redirects the browser here after consent. We exchange the code for tokens,
    fetch the connected tenant, persist the config, and redirect the user back to
    Settings → System.
    """
    permission_classes = [AllowAny]   # Xero hits this URL with the browser; no auth header

    def get(self, request):
        error = request.GET.get('error')
        if error:
            return self._redirect_to_settings(error=request.GET.get('error_description') or error)

        code = request.GET.get('code')
        state = request.GET.get('state')
        if not code or not state:
            return self._redirect_to_settings(error='Missing code or state.')

        try:
            marina_id = _unsign_state(state)
        except SignatureExpired:
            return self._redirect_to_settings(error='Authorization request expired. Try again.')
        except BadSignature:
            return self._redirect_to_settings(error='Invalid state.')

        # Exchange code for tokens
        try:
            token_response = requests.post(
                XERO_TOKEN_URL,
                data={
                    'grant_type':   'authorization_code',
                    'code':         code,
                    'redirect_uri': settings.XERO_REDIRECT_URI,
                },
                auth=(settings.XERO_CLIENT_ID, settings.XERO_CLIENT_SECRET),
                timeout=15,
            )
        except requests.RequestException as exc:
            return self._redirect_to_settings(error=f'Xero token request failed: {exc}')

        if not token_response.ok:
            return self._redirect_to_settings(error=f'Xero token exchange failed: {token_response.text[:200]}')

        token = token_response.json()
        access_token = token['access_token']
        refresh_token = token.get('refresh_token', '')
        expires_at = datetime.now(tz=dt_timezone.utc).timestamp() + token.get('expires_in', 1800)

        # Fetch the tenant(s) this connection grants access to.
        try:
            connections = requests.get(
                XERO_CONNECTIONS_URL,
                headers={'Authorization': f'Bearer {access_token}'},
                timeout=10,
            )
        except requests.RequestException as exc:
            return self._redirect_to_settings(error=f'Xero connections lookup failed: {exc}')

        if not connections.ok:
            return self._redirect_to_settings(error=f'Xero connections lookup failed: {connections.text[:200]}')

        tenants = connections.json() or []
        if not tenants:
            return self._redirect_to_settings(error='Xero returned no tenants for this connection.')

        # We use the first tenant. A multi-tenant picker can be added later.
        tenant = tenants[0]
        tenant_id = tenant.get('tenantId') or tenant.get('TenantId') or ''
        tenant_name = tenant.get('tenantName') or tenant.get('TenantName') or ''

        config, _ = AccountingIntegrationConfig.objects.update_or_create(
            marina_id=marina_id,
            platform=AccountingIntegrationConfig.Platform.XERO,
            defaults={
                'company_id': tenant_id,
                'base_url':   tenant_name,   # display label; adapter doesn't use base_url for Xero
                'is_active':  True,
                'credentials': {
                    'access_token':  access_token,
                    'refresh_token': refresh_token,
                    'expires_at':    expires_at,
                    'client_id':     settings.XERO_CLIENT_ID,
                    'client_secret': settings.XERO_CLIENT_SECRET,
                },
            },
        )
        return self._redirect_to_settings(connected=True, platform='xero')

    def _redirect_to_settings(self, connected=False, platform=None, error=None):
        base = getattr(settings, 'FRONTEND_URL', '') or '/'
        params = {}
        if connected:
            params['integration'] = platform or 'xero'
            params['status'] = 'connected'
        if error:
            params['integration'] = platform or 'xero'
            params['status'] = 'error'
            params['error'] = error
        url = f'{base.rstrip("/")}/settings?tab=system'
        if params:
            url = f'{url}&{urlencode(params)}'
        return redirect(url)


class XeroDisconnectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        marina = request.user.marina
        if marina is None:
            return Response({'detail': 'User is not attached to a marina.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            config = AccountingIntegrationConfig.objects.get(
                marina=marina,
                platform=AccountingIntegrationConfig.Platform.XERO,
            )
        except AccountingIntegrationConfig.DoesNotExist:
            return Response({'detail': 'Not connected.'}, status=status.HTTP_404_NOT_FOUND)

        config.credentials = {}
        config.is_active = False
        config.save(update_fields=['credentials', 'is_active'])
        return Response({'detail': 'Disconnected.'})

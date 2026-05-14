"""
Sage Business Cloud Accounting OAuth2 flow.

Endpoints:
  GET  /sage/authorize/
  GET  /sage/callback/
  POST /sage/disconnect/

Pattern mirrors Xero and QBO: signed-state TimestampSigner with 10-min TTL,
final redirect back to FRONTEND_URL/settings?tab=system.
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

SAGE_AUTHORIZE_URL = 'https://www.sageone.com/oauth2/auth/central'
SAGE_TOKEN_URL = 'https://oauth.accounting.sage.com/token'
SAGE_API_BASE = 'https://api.accounting.sage.com/v3.1'

_STATE_SALT = 'accounting.sage.oauth'
_STATE_MAX_AGE_SECONDS = 600


def _sage_configured():
    return bool(
        settings.SAGE_CLIENT_ID
        and settings.SAGE_CLIENT_SECRET
        and settings.SAGE_REDIRECT_URI
    )


def _sign_state(marina_id: int) -> str:
    payload = f'{marina_id}:{secrets.token_urlsafe(8)}'
    return TimestampSigner(salt=_STATE_SALT).sign(payload)


def _unsign_state(state: str) -> int:
    payload = TimestampSigner(salt=_STATE_SALT).unsign(state, max_age=_STATE_MAX_AGE_SECONDS)
    return int(payload.split(':', 1)[0])


def _redirect_to_settings(connected=False, error=None):
    base = getattr(settings, 'FRONTEND_URL', '') or '/'
    params = {'integration': 'sage_business_cloud'}
    if connected:
        params['status'] = 'connected'
    if error:
        params['status'] = 'error'
        params['error'] = error
    return redirect(f'{base.rstrip("/")}/settings?tab=system&{urlencode(params)}')


class SageAuthorizeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _sage_configured():
            return Response(
                {'detail': 'Sage Business Cloud is not configured on this server. '
                           'SAGE_CLIENT_ID, SAGE_CLIENT_SECRET, and SAGE_REDIRECT_URI must be set.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        marina = request.user.marina
        if marina is None:
            return Response({'detail': 'User is not attached to a marina.'},
                            status=status.HTTP_400_BAD_REQUEST)
        params = {
            'response_type':  'code',
            'client_id':      settings.SAGE_CLIENT_ID,
            'redirect_uri':   settings.SAGE_REDIRECT_URI,
            'scope':          settings.SAGE_SCOPES,
            'state':          _sign_state(marina.pk),
            'country':        settings.SAGE_COUNTRY or 'gb',
        }
        return Response({'authorize_url': f'{SAGE_AUTHORIZE_URL}?{urlencode(params)}'})


class SageCallbackView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        error = request.GET.get('error')
        if error:
            return _redirect_to_settings(error=request.GET.get('error_description') or error)
        code = request.GET.get('code')
        state = request.GET.get('state')
        if not code or not state:
            return _redirect_to_settings(error='Missing code or state.')
        try:
            marina_id = _unsign_state(state)
        except SignatureExpired:
            return _redirect_to_settings(error='Authorization request expired.')
        except BadSignature:
            return _redirect_to_settings(error='Invalid state.')

        try:
            token_response = requests.post(
                SAGE_TOKEN_URL,
                data={
                    'grant_type':    'authorization_code',
                    'code':          code,
                    'client_id':     settings.SAGE_CLIENT_ID,
                    'client_secret': settings.SAGE_CLIENT_SECRET,
                    'redirect_uri':  settings.SAGE_REDIRECT_URI,
                },
                timeout=15,
            )
        except requests.RequestException as exc:
            return _redirect_to_settings(error=f'Sage token request failed: {exc}')

        if not token_response.ok:
            return _redirect_to_settings(error=f'Sage token exchange failed: {token_response.text[:200]}')

        token = token_response.json()
        access_token = token['access_token']
        refresh_token = token.get('refresh_token', '')
        expires_at = datetime.now(tz=dt_timezone.utc).timestamp() + token.get('expires_in', 300)

        # Fetch business list to determine which business this connection grants access to.
        business_id = ''
        business_name = ''
        try:
            businesses = requests.get(
                f'{SAGE_API_BASE}/businesses',
                headers={'Authorization': f'Bearer {access_token}', 'Accept': 'application/json'},
                timeout=10,
            )
            if businesses.ok:
                payload = businesses.json()
                items = payload.get('$items') if isinstance(payload, dict) else payload
                if items:
                    first = items[0]
                    business_id = first.get('id', '')
                    business_name = first.get('name') or first.get('displayed_as', '') or ''
        except requests.RequestException:
            pass

        AccountingIntegrationConfig.objects.update_or_create(
            marina_id=marina_id,
            platform='sage_business_cloud',
            defaults={
                'company_id': business_id,
                'base_url':   business_name or 'Sage Business Cloud',
                'is_active':  True,
                'credentials': {
                    'access_token':  access_token,
                    'refresh_token': refresh_token,
                    'expires_at':    expires_at,
                    'client_id':     settings.SAGE_CLIENT_ID,
                    'client_secret': settings.SAGE_CLIENT_SECRET,
                },
            },
        )
        return _redirect_to_settings(connected=True)


class SageDisconnectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        marina = request.user.marina
        if marina is None:
            return Response({'detail': 'User is not attached to a marina.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            config = AccountingIntegrationConfig.objects.get(
                marina=marina, platform='sage_business_cloud',
            )
        except AccountingIntegrationConfig.DoesNotExist:
            return Response({'detail': 'Not connected.'}, status=status.HTTP_404_NOT_FOUND)
        config.credentials = {}
        config.is_active = False
        config.save(update_fields=['credentials', 'is_active'])
        return Response({'detail': 'Disconnected.'})

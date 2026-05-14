"""
MYOB AccountRight Live OAuth2 flow.

Endpoints:
  GET  /myob/authorize/
  GET  /myob/callback/
  POST /myob/disconnect/
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

MYOB_AUTHORIZE_URL = 'https://secure.myob.com/oauth2/account/authorize'
MYOB_TOKEN_URL     = 'https://secure.myob.com/oauth2/v1/authorize'
MYOB_API_BASE      = 'https://api.myob.com/accountright'

_STATE_SALT = 'accounting.myob.oauth'
_STATE_MAX_AGE = 600


def _configured():
    return bool(
        settings.MYOB_CLIENT_ID and settings.MYOB_CLIENT_SECRET and settings.MYOB_REDIRECT_URI
    )


def _sign_state(marina_id: int) -> str:
    payload = f'{marina_id}:{secrets.token_urlsafe(8)}'
    return TimestampSigner(salt=_STATE_SALT).sign(payload)


def _unsign_state(state: str) -> int:
    payload = TimestampSigner(salt=_STATE_SALT).unsign(state, max_age=_STATE_MAX_AGE)
    return int(payload.split(':', 1)[0])


def _redirect_to_settings(connected=False, error=None):
    base = getattr(settings, 'FRONTEND_URL', '') or '/'
    params = {'integration': 'myob'}
    if connected:
        params['status'] = 'connected'
    if error:
        params['status'] = 'error'
        params['error'] = error
    return redirect(f'{base.rstrip("/")}/settings?tab=system&{urlencode(params)}')


class MYOBAuthorizeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _configured():
            return Response(
                {'detail': 'MYOB is not configured on this server. '
                           'MYOB_CLIENT_ID, MYOB_CLIENT_SECRET, and MYOB_REDIRECT_URI must be set.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        marina = request.user.marina
        if marina is None:
            return Response({'detail': 'User is not attached to a marina.'},
                            status=status.HTTP_400_BAD_REQUEST)
        params = {
            'client_id':     settings.MYOB_CLIENT_ID,
            'redirect_uri':  settings.MYOB_REDIRECT_URI,
            'response_type': 'code',
            'scope':         settings.MYOB_SCOPES,
            'state':         _sign_state(marina.pk),
        }
        return Response({'authorize_url': f'{MYOB_AUTHORIZE_URL}?{urlencode(params)}'})


class MYOBCallbackView(APIView):
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
                MYOB_TOKEN_URL,
                data={
                    'grant_type':    'authorization_code',
                    'code':          code,
                    'client_id':     settings.MYOB_CLIENT_ID,
                    'client_secret': settings.MYOB_CLIENT_SECRET,
                    'redirect_uri':  settings.MYOB_REDIRECT_URI,
                    'scope':         settings.MYOB_SCOPES,
                },
                timeout=15,
            )
        except requests.RequestException as exc:
            return _redirect_to_settings(error=f'MYOB token request failed: {exc}')

        if not token_response.ok:
            return _redirect_to_settings(error=f'MYOB token exchange failed: {token_response.text[:200]}')

        token = token_response.json()
        access_token  = token['access_token']
        refresh_token = token.get('refresh_token', '')
        expires_at    = datetime.now(tz=dt_timezone.utc).timestamp() + token.get('expires_in', 1200)

        # Pick the first company file accessible to this user. A multi-file
        # picker can be added later.
        company_uri = ''
        company_name = ''
        try:
            cf = requests.get(
                MYOB_API_BASE,
                headers={
                    'Authorization':     f'Bearer {access_token}',
                    'x-myobapi-key':     settings.MYOB_CLIENT_ID,
                    'x-myobapi-version': 'v2',
                    'Accept':            'application/json',
                },
                timeout=10,
            )
            if cf.ok:
                items = cf.json() or []
                if isinstance(items, list) and items:
                    company_uri  = items[0].get('Uri', '')
                    company_name = items[0].get('Name', '')
        except requests.RequestException:
            pass

        AccountingIntegrationConfig.objects.update_or_create(
            marina_id=marina_id,
            platform='myob',
            defaults={
                'company_id': company_uri,
                'base_url':   company_name or 'MYOB',
                'is_active':  True,
                'credentials': {
                    'access_token':  access_token,
                    'refresh_token': refresh_token,
                    'expires_at':    expires_at,
                    'client_id':     settings.MYOB_CLIENT_ID,
                    'client_secret': settings.MYOB_CLIENT_SECRET,
                },
            },
        )
        return _redirect_to_settings(connected=True)


class MYOBDisconnectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        marina = request.user.marina
        if marina is None:
            return Response({'detail': 'User is not attached to a marina.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            config = AccountingIntegrationConfig.objects.get(marina=marina, platform='myob')
        except AccountingIntegrationConfig.DoesNotExist:
            return Response({'detail': 'Not connected.'}, status=status.HTTP_404_NOT_FOUND)
        config.credentials = {}
        config.is_active = False
        config.save(update_fields=['credentials', 'is_active'])
        return Response({'detail': 'Disconnected.'})

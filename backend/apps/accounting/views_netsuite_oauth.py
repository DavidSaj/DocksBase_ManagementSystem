"""
NetSuite OAuth2 flow.

NetSuite's OAuth2 endpoints are scoped to the customer's Account ID, so the
authorize URL can't be built until we know which account to talk to. The
frontend calls /netsuite/authorize/?account_id=XYZ to get the URL.

Endpoints:
  GET  /netsuite/authorize/?account_id=XYZ
  GET  /netsuite/callback/
  POST /netsuite/disconnect/
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

_STATE_SALT = 'accounting.netsuite.oauth'
_STATE_MAX_AGE = 600


def _configured():
    return bool(
        settings.NETSUITE_CLIENT_ID
        and settings.NETSUITE_CLIENT_SECRET
        and settings.NETSUITE_REDIRECT_URI
    )


def _account_subdomain(account_id: str) -> str:
    return account_id.lower().replace('_', '-')


def _authorize_url(account_id: str) -> str:
    return f'https://{_account_subdomain(account_id)}.app.netsuite.com/app/login/oauth2/authorize.nl'


def _token_url(account_id: str) -> str:
    return f'https://{_account_subdomain(account_id)}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token'


def _sign_state(marina_id: int, account_id: str) -> str:
    payload = f'{marina_id}:{account_id}:{secrets.token_urlsafe(8)}'
    return TimestampSigner(salt=_STATE_SALT).sign(payload)


def _unsign_state(state: str):
    payload = TimestampSigner(salt=_STATE_SALT).unsign(state, max_age=_STATE_MAX_AGE)
    parts = payload.split(':', 2)
    return int(parts[0]), parts[1]


def _redirect_to_settings(connected=False, error=None):
    base = getattr(settings, 'FRONTEND_URL', '') or '/'
    params = {'integration': 'netsuite'}
    if connected:
        params['status'] = 'connected'
    if error:
        params['status'] = 'error'
        params['error'] = error
    return redirect(f'{base.rstrip("/")}/settings?tab=system&{urlencode(params)}')


class NetSuiteAuthorizeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _configured():
            return Response(
                {'detail': 'NetSuite is not configured on this server. '
                           'NETSUITE_CLIENT_ID, NETSUITE_CLIENT_SECRET, and NETSUITE_REDIRECT_URI must be set.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        marina = request.user.marina
        if marina is None:
            return Response({'detail': 'User is not attached to a marina.'},
                            status=status.HTTP_400_BAD_REQUEST)
        account_id = request.query_params.get('account_id', '').strip()
        if not account_id:
            return Response({'detail': 'account_id query parameter is required (your NetSuite Account ID).'},
                            status=status.HTTP_400_BAD_REQUEST)

        params = {
            'response_type': 'code',
            'client_id':     settings.NETSUITE_CLIENT_ID,
            'redirect_uri':  settings.NETSUITE_REDIRECT_URI,
            'scope':         settings.NETSUITE_SCOPES,
            'state':         _sign_state(marina.pk, account_id),
        }
        return Response({'authorize_url': f'{_authorize_url(account_id)}?{urlencode(params)}'})


class NetSuiteCallbackView(APIView):
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
            marina_id, account_id = _unsign_state(state)
        except SignatureExpired:
            return _redirect_to_settings(error='Authorization request expired.')
        except BadSignature:
            return _redirect_to_settings(error='Invalid state.')

        try:
            token_response = requests.post(
                _token_url(account_id),
                data={
                    'grant_type':   'authorization_code',
                    'code':         code,
                    'redirect_uri': settings.NETSUITE_REDIRECT_URI,
                },
                auth=(settings.NETSUITE_CLIENT_ID, settings.NETSUITE_CLIENT_SECRET),
                timeout=15,
            )
        except requests.RequestException as exc:
            return _redirect_to_settings(error=f'NetSuite token request failed: {exc}')

        if not token_response.ok:
            return _redirect_to_settings(error=f'NetSuite token exchange failed: {token_response.text[:200]}')

        token = token_response.json()
        access_token  = token['access_token']
        refresh_token = token.get('refresh_token', '')
        expires_at    = datetime.now(tz=dt_timezone.utc).timestamp() + token.get('expires_in', 3600)

        AccountingIntegrationConfig.objects.update_or_create(
            marina_id=marina_id,
            platform='netsuite',
            defaults={
                'company_id': account_id,
                'base_url':   f'NetSuite ({account_id})',
                'is_active':  True,
                'credentials': {
                    'access_token':  access_token,
                    'refresh_token': refresh_token,
                    'expires_at':    expires_at,
                    'client_id':     settings.NETSUITE_CLIENT_ID,
                    'client_secret': settings.NETSUITE_CLIENT_SECRET,
                },
            },
        )
        return _redirect_to_settings(connected=True)


class NetSuiteDisconnectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        marina = request.user.marina
        if marina is None:
            return Response({'detail': 'User is not attached to a marina.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            config = AccountingIntegrationConfig.objects.get(marina=marina, platform='netsuite')
        except AccountingIntegrationConfig.DoesNotExist:
            return Response({'detail': 'Not connected.'}, status=status.HTTP_404_NOT_FOUND)
        config.credentials = {}
        config.is_active = False
        config.save(update_fields=['credentials', 'is_active'])
        return Response({'detail': 'Disconnected.'})

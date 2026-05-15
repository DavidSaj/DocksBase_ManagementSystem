"""
Microsoft Dynamics 365 Business Central OAuth2 (Azure AD) flow.

Endpoints:
  GET  /d365/authorize/
  GET  /d365/callback/
  POST /d365/disconnect/
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

BC_API_BASE = 'https://api.businesscentral.dynamics.com/v2.0'
BC_SCOPE_RESOURCE = 'https://api.businesscentral.dynamics.com/.default'

_STATE_SALT = 'accounting.d365.oauth'
_STATE_MAX_AGE = 600


def _configured():
    return bool(settings.D365_CLIENT_ID and settings.D365_CLIENT_SECRET and settings.D365_REDIRECT_URI)


def _sign_state(marina_id: int) -> str:
    payload = f'{marina_id}:{secrets.token_urlsafe(8)}'
    return TimestampSigner(salt=_STATE_SALT).sign(payload)


def _unsign_state(state: str) -> int:
    payload = TimestampSigner(salt=_STATE_SALT).unsign(state, max_age=_STATE_MAX_AGE)
    return int(payload.split(':', 1)[0])


def _redirect_to_settings(connected=False, error=None):
    base = getattr(settings, 'FRONTEND_URL', '') or '/'
    params = {'integration': 'dynamics365'}
    if connected:
        params['status'] = 'connected'
    if error:
        params['status'] = 'error'
        params['error'] = error
    return redirect(f'{base.rstrip("/")}/settings?tab=system&{urlencode(params)}')


def _authorize_url(tenant: str) -> str:
    return f'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize'


def _token_url(tenant: str) -> str:
    return f'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token'


class D365AuthorizeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _configured():
            return Response(
                {'detail': 'Dynamics 365 is not configured on this server. '
                           'D365_CLIENT_ID, D365_CLIENT_SECRET, and D365_REDIRECT_URI must be set.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        marina = request.user.marina
        if marina is None:
            return Response({'detail': 'User is not attached to a marina.'},
                            status=status.HTTP_400_BAD_REQUEST)
        tenant = settings.D365_TENANT or 'organizations'
        params = {
            'client_id':     settings.D365_CLIENT_ID,
            'response_type': 'code',
            'redirect_uri':  settings.D365_REDIRECT_URI,
            'response_mode': 'query',
            'scope':         f'{BC_SCOPE_RESOURCE} offline_access',
            'state':         _sign_state(marina.pk),
        }
        return Response({'authorize_url': f'{_authorize_url(tenant)}?{urlencode(params)}'})


class D365CallbackView(APIView):
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

        tenant = settings.D365_TENANT or 'organizations'
        try:
            token_response = requests.post(
                _token_url(tenant),
                data={
                    'grant_type':    'authorization_code',
                    'code':          code,
                    'redirect_uri':  settings.D365_REDIRECT_URI,
                    'client_id':     settings.D365_CLIENT_ID,
                    'client_secret': settings.D365_CLIENT_SECRET,
                    'scope':         f'{BC_SCOPE_RESOURCE} offline_access',
                },
                timeout=15,
            )
        except requests.RequestException as exc:
            return _redirect_to_settings(error=f'D365 token request failed: {exc}')
        if not token_response.ok:
            return _redirect_to_settings(error=f'D365 token exchange failed: {token_response.text[:200]}')

        token = token_response.json()
        access_token  = token['access_token']
        refresh_token = token.get('refresh_token', '')
        expires_at    = datetime.now(tz=dt_timezone.utc).timestamp() + token.get('expires_in', 3600)

        # Resolve actual AAD tenant id from the id_token (preferred when tenant='organizations').
        aad_tenant_id = tenant
        try:
            import base64, json
            id_token = token.get('id_token', '')
            if id_token and id_token.count('.') >= 2:
                payload = id_token.split('.')[1]
                padding = '=' * (-len(payload) % 4)
                claims = json.loads(base64.urlsafe_b64decode(payload + padding))
                aad_tenant_id = claims.get('tid', tenant)
        except Exception:
            pass

        # Pick the first company in the first environment as a default. A
        # multi-environment picker can be layered on later.
        environment = settings.D365_ENVIRONMENT or 'production'
        company_id = ''
        company_name = ''
        try:
            r = requests.get(
                f'{BC_API_BASE}/{aad_tenant_id}/{environment}/api/v2.0/companies?$top=1',
                headers={'Authorization': f'Bearer {access_token}', 'Accept': 'application/json'},
                timeout=10,
            )
            if r.ok:
                values = r.json().get('value', [])
                if values:
                    company_id   = values[0].get('id', '')
                    company_name = values[0].get('displayName', '') or values[0].get('name', '')
        except requests.RequestException:
            pass

        AccountingIntegrationConfig.objects.update_or_create(
            marina_id=marina_id,
            platform='dynamics365',
            defaults={
                'company_id': company_id,
                'base_url':   environment,
                'is_active':  True,
                'credentials': {
                    'access_token':  access_token,
                    'refresh_token': refresh_token,
                    'expires_at':    expires_at,
                    'aad_tenant_id': aad_tenant_id,
                    'client_id':     settings.D365_CLIENT_ID,
                    'client_secret': settings.D365_CLIENT_SECRET,
                    'company_name':  company_name,
                },
            },
        )
        return _redirect_to_settings(connected=True)


class D365DisconnectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        marina = request.user.marina
        if marina is None:
            return Response({'detail': 'User is not attached to a marina.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            config = AccountingIntegrationConfig.objects.get(marina=marina, platform='dynamics365')
        except AccountingIntegrationConfig.DoesNotExist:
            return Response({'detail': 'Not connected.'}, status=status.HTTP_404_NOT_FOUND)
        config.credentials = {}
        config.is_active = False
        config.save(update_fields=['credentials', 'is_active'])
        return Response({'detail': 'Disconnected.'})

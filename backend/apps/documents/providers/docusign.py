"""
DocuSignProvider — JWT-Grant auth + DocuSign eSignature REST API.

Auth flow (JWT Grant — server-to-server, no interactive OAuth):

  1. Sign a JWT with the marina's RSA private key. Claims: iss (integration
     key), sub (impersonation user id), aud (account-data.docusign.com or
     account-d.docusign.com for the demo env), scope, iat, exp.
  2. POST it to {oauth_host}/oauth/token. DocuSign returns an access token
     valid ~1 hour and the user's per-account base URI.
  3. Cache the access token in Django cache so we don't re-sign on every call.

The credentials live on `marina`:
  - docusign_api_key      — Integration Key (client_id in JWT iss claim)
  - docusign_user_id      — Impersonation user GUID (sub claim)
  - docusign_account_id   — API Account ID used in REST paths
  - docusign_private_key  — RSA private key paired with a public key uploaded
                            to DocuSign Admin → Apps and Keys
  - docusign_base_url     — Account base URL, e.g.
                            https://demo.docusign.net/restapi (sandbox) or
                            https://na2.docusign.net/restapi (production)

Template upload (`create_embedded_template_draft`) is intentionally NOT
implemented: DocuSign's embedded template creation flow is materially
different from Dropbox Sign's (uses Apply Template + Sender View URLs). For
v1 the manager creates templates in the DocuSign portal and pastes the
template id into our DocTemplate.docusign_template_id. We'll layer the
embedded sender view on top in a follow-up.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta

from django.core.cache import cache

from .base import ESignProvider


def _is_demo(base_url: str) -> bool:
    return 'demo.docusign' in (base_url or '') or 'account-d.docusign' in (base_url or '')


def _oauth_host(base_url: str) -> str:
    """Pick the right account-data host for the configured account."""
    return 'account-d.docusign.com' if _is_demo(base_url) else 'account.docusign.com'


class DocuSignProvider(ESignProvider):
    SCOPE = 'signature impersonation'
    TOKEN_TTL_SECONDS = 50 * 60  # tokens expire in 60 min; refresh a touch early

    # ── Auth ───────────────────────────────────────────────────────────

    def _access_token(self) -> str:
        cache_key = f'docusign:token:marina:{self.marina.pk}'
        token = cache.get(cache_key)
        if token:
            return token

        import jwt as pyjwt
        import requests

        now = int(time.time())
        claims = {
            'iss':   self.marina.docusign_api_key,
            'sub':   self.marina.docusign_user_id,
            'aud':   _oauth_host(self.marina.docusign_base_url),
            'iat':   now,
            'exp':   now + 60 * 60,
            'scope': self.SCOPE,
        }
        assertion = pyjwt.encode(
            claims,
            self.marina.docusign_private_key,
            algorithm='RS256',
        )

        resp = requests.post(
            f'https://{_oauth_host(self.marina.docusign_base_url)}/oauth/token',
            data={
                'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                'assertion':  assertion,
            },
            timeout=10,
        )
        if not resp.ok:
            raise RuntimeError(
                f'DocuSign JWT exchange failed ({resp.status_code}): {resp.text[:200]}'
            )
        token = resp.json()['access_token']
        cache.set(cache_key, token, self.TOKEN_TTL_SECONDS)
        return token

    def _headers(self) -> dict:
        return {
            'Authorization': f'Bearer {self._access_token()}',
            'Content-Type':  'application/json',
        }

    def _envelopes_url(self, *suffix: str) -> str:
        base = self.marina.docusign_base_url.rstrip('/')
        account = self.marina.docusign_account_id
        return '/'.join([base, 'v2.1', 'accounts', account, 'envelopes', *suffix])

    # ── ESignProvider interface ───────────────────────────────────────

    def create_embedded_template_draft(self, template, file_path: str) -> str:
        raise NotImplementedError(
            'DocuSign template upload (embedded sender view) is not yet implemented. '
            'For now, create the template in the DocuSign portal and paste its id '
            'into DocTemplate.docusign_template_id.'
        )

    def send_envelope(self, envelope) -> str:
        import requests
        payload = {
            'templateId':    envelope.template.docusign_template_id,
            'templateRoles': [{
                'email':    envelope.recipient.email,
                'name':     envelope.recipient.name,
                'roleName': 'Member',
            }],
            'status':        'sent',
            'customFields':  {
                'textCustomFields': [
                    {'name': 'marina_id',   'value': str(envelope.marina_id),  'required': 'false'},
                    {'name': 'envelope_pk', 'value': str(envelope.pk),         'required': 'false'},
                ],
            },
        }
        r = requests.post(self._envelopes_url(), headers=self._headers(),
                          data=json.dumps(payload), timeout=15)
        if not r.ok:
            raise RuntimeError(f'DocuSign send failed ({r.status_code}): {r.text[:200]}')
        return r.json()['envelopeId']

    def get_signed_pdf_url(self, envelope_id: str) -> str:
        """
        DocuSign signed PDFs are fetched via a binary GET on the envelope's
        `documents/combined` endpoint. We don't proxy the PDF — instead we
        return a short-lived signed URL by asking for the recipient view URL
        with the 'completed' return flow, which lets the manager download.
        """
        import requests
        r = requests.post(
            self._envelopes_url(envelope_id, 'views', 'sender'),
            headers=self._headers(),
            data=json.dumps({
                'returnUrl': 'https://www.docksbase.com/post-sign-return',
            }),
            timeout=10,
        )
        if not r.ok:
            raise RuntimeError(f'DocuSign view url failed ({r.status_code}): {r.text[:200]}')
        return r.json()['url']

    def create_embedded_sign_url(
        self, booking, template_id: str, *, envelope_pk=None,
    ) -> tuple[str, str]:
        import requests
        # Step 1: create an envelope from the template.
        send_payload = {
            'templateId':    template_id,
            'status':        'sent',
            'templateRoles': [{
                'email':            booking.guest_email,
                'name':             booking.guest_name or 'Boater',
                'roleName':         'Boater',
                'clientUserId':     str(booking.id),
            }],
            'customFields':  {
                'textCustomFields': [
                    {'name': 'booking_id',  'value': str(booking.id),
                     'required': 'false'},
                    *([{'name': 'envelope_pk', 'value': str(envelope_pk),
                        'required': 'false'}] if envelope_pk is not None else []),
                ],
            },
        }
        send = requests.post(self._envelopes_url(), headers=self._headers(),
                             data=json.dumps(send_payload), timeout=15)
        if not send.ok:
            raise RuntimeError(f'DocuSign create envelope failed ({send.status_code}): {send.text[:200]}')
        envelope_id = send.json()['envelopeId']

        # Step 2: ask for the recipient view URL (embedded signing).
        view = requests.post(
            self._envelopes_url(envelope_id, 'views', 'recipient'),
            headers=self._headers(),
            data=json.dumps({
                'authenticationMethod': 'none',
                'email':                booking.guest_email,
                'userName':             booking.guest_name or 'Boater',
                'clientUserId':         str(booking.id),
                'returnUrl':            'https://www.docksbase.com/post-sign-return',
            }),
            timeout=10,
        )
        if not view.ok:
            raise RuntimeError(f'DocuSign recipient view failed ({view.status_code}): {view.text[:200]}')
        return envelope_id, view.json()['url']

    def get_existing_embedded_sign_url(self, envelope_id: str) -> str:
        import requests
        # Look up the envelope to recover the recipient email/name/client id.
        env = requests.get(
            self._envelopes_url(envelope_id, 'recipients'),
            headers=self._headers(), timeout=10,
        )
        if not env.ok:
            raise RuntimeError(f'DocuSign recipients lookup failed ({env.status_code}): {env.text[:200]}')
        signers = env.json().get('signers') or []
        if not signers:
            raise RuntimeError('DocuSign envelope has no signers.')
        signer = signers[0]

        view = requests.post(
            self._envelopes_url(envelope_id, 'views', 'recipient'),
            headers=self._headers(),
            data=json.dumps({
                'authenticationMethod': 'none',
                'email':                signer['email'],
                'userName':             signer.get('name', 'Boater'),
                'clientUserId':         signer.get('clientUserId', ''),
                'returnUrl':            'https://www.docksbase.com/post-sign-return',
            }),
            timeout=10,
        )
        if not view.ok:
            raise RuntimeError(f'DocuSign recipient view failed ({view.status_code}): {view.text[:200]}')
        return view.json()['url']

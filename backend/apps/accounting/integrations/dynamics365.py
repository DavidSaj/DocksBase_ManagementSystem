"""
apps/accounting/integrations/dynamics365.py

Microsoft Dynamics 365 Business Central adapter (Azure AD OAuth2).

Auth: Azure AD authorization-code flow against the tenant's AAD endpoint.
config.company_id stores the BC company GUID.
config.base_url stores the environment name (e.g. "production" or sandbox).

API: https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/
"""

import logging
from datetime import datetime, timezone

import requests
from django.conf import settings

from apps.accounting.integrations.base import (
    AccountingAdapter,
    AdapterError,
    AdapterRetryableError,
)

logger = logging.getLogger(__name__)

BC_API_BASE = 'https://api.businesscentral.dynamics.com/v2.0'
BC_SCOPE_RESOURCE = 'https://api.businesscentral.dynamics.com/.default'


def _aad_token_url(tenant: str) -> str:
    return f'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token'


class Dynamics365Adapter(AccountingAdapter):
    """Microsoft Dynamics 365 Business Central adapter."""

    def _credentials(self) -> dict:
        return self.config.credentials or {}

    def _refresh_token_if_needed(self) -> str:
        creds = self._credentials()
        expires_at = creds.get('expires_at', 0)
        now_ts = datetime.now(tz=timezone.utc).timestamp()
        if now_ts < expires_at - 60:
            return creds['access_token']

        refresh_token = creds.get('refresh_token')
        tenant = creds.get('tenant') or settings.D365_TENANT or 'common'
        if not refresh_token:
            raise AdapterError('Dynamics 365: no refresh token available. Re-authorise.')

        response = requests.post(
            _aad_token_url(tenant),
            data={
                'grant_type':    'refresh_token',
                'refresh_token': refresh_token,
                'client_id':     creds.get('client_id') or settings.D365_CLIENT_ID,
                'client_secret': creds.get('client_secret') or settings.D365_CLIENT_SECRET,
                'scope':         f'{BC_SCOPE_RESOURCE} offline_access',
            },
            timeout=10,
        )
        if response.status_code != 200:
            raise AdapterError(f'D365 token refresh failed: {response.text}')

        token = response.json()
        new_creds = {
            **creds,
            'access_token':  token['access_token'],
            'refresh_token': token.get('refresh_token', refresh_token),
            'expires_at':    now_ts + token.get('expires_in', 3600),
        }
        self.config.credentials = new_creds
        self.config.save(update_fields=['credentials'])
        return new_creds['access_token']

    def _headers(self) -> dict:
        return {
            'Authorization': f'Bearer {self._refresh_token_if_needed()}',
            'Accept':        'application/json',
            'Content-Type':  'application/json',
        }

    def _url(self, path: str) -> str:
        creds = self._credentials()
        tenant = creds.get('aad_tenant_id') or creds.get('tenant') or settings.D365_TENANT
        environment = self.config.base_url or 'production'
        company_id = self.config.company_id
        return f'{BC_API_BASE}/{tenant}/{environment}/api/v2.0/companies({company_id})/{path}'

    def _get(self, path: str) -> dict:
        response = requests.get(self._url(path), headers=self._headers(), timeout=15)
        if response.status_code == 429:
            raise AdapterRetryableError('D365 rate limit hit.')
        if not response.ok:
            raise AdapterError(f'D365 GET {path} failed: {response.status_code} {response.text}')
        return response.json()

    def _post(self, path: str, payload: dict) -> dict:
        response = requests.post(self._url(path), headers=self._headers(), json=payload, timeout=15)
        if response.status_code == 429:
            raise AdapterRetryableError('D365 rate limit hit.')
        if not response.ok:
            raise AdapterError(f'D365 POST {path} failed: {response.status_code} {response.text}')
        return response.json() if response.content else {}

    # ------------------------------------------------------------------
    # Abstract method implementations
    # ------------------------------------------------------------------

    def test_connection(self) -> bool:
        try:
            self._get('accounts?$top=1')
            return True
        except requests.Timeout:
            raise AdapterRetryableError('D365 connection timed out.')

    def push_invoice(self, invoice) -> str:
        customer_id = self._customer_id(invoice.member) if invoice.member else None
        payload = {
            'invoiceDate':            invoice.created_at.date().isoformat() if invoice.created_at else None,
            'dueDate':                invoice.due_date.isoformat() if invoice.due_date else None,
            'customerId':             customer_id,
            'externalDocumentNumber': invoice.invoice_number,
        }
        result = self._post('salesInvoices', payload)
        bc_id = result.get('id', '')
        for item in invoice.items.all():
            self._post(
                f"salesInvoices({bc_id})/salesInvoiceLines",
                {
                    'lineType':    'Item',
                    'description': item.description,
                    'quantity':    float(item.quantity),
                    'unitPrice':   float(item.unit_price),
                },
            )
        return bc_id

    def push_payment(self, payment) -> str:
        invoice = payment.invoice
        payload = {
            'postingDate':    payment.paid_at.date().isoformat() if payment.paid_at else '',
            'documentNumber': f'PAY-{payment.pk}',
            'accountType':    'Customer',
            'customerId':     self._customer_id(invoice.member) if invoice.member else None,
            'amount':         -float(payment.amount),
            'description':    f'Payment for {invoice.invoice_number}',
        }
        result = self._post('journalLines', payload)
        return result.get('id', '')

    def push_journal_entry(self, journal_entry) -> str:
        last_id = ''
        for line in journal_entry.lines.select_related('account').all():
            payload = {
                'postingDate':    journal_entry.entry_date.isoformat() if journal_entry.entry_date else '',
                'documentNumber': journal_entry.reference or f'JE-{journal_entry.pk}',
                'accountType':    'G/L Account',
                'accountNumber':  line.account.external_code or line.account.code,
                'amount':         float(line.debit) - float(line.credit),
                'description':    (line.description or journal_entry.description or '')[:50],
            }
            result = self._post('journalLines', payload)
            last_id = result.get('id', last_id)
        return last_id

    def sync_chart_of_accounts(self) -> list:
        data = self._get('accounts?$top=1000')
        items = data.get('value', []) if isinstance(data, dict) else data
        return [
            {
                'code':          a.get('number', ''),
                'name':          a.get('displayName', '') or a.get('name', ''),
                'account_type':  _bc_type_to_local(a.get('category', '')),
                'external_code': a.get('id', ''),
            }
            for a in items
        ]

    def sync_contacts(self) -> list:
        data = self._get('customers?$top=1000')
        items = data.get('value', []) if isinstance(data, dict) else data
        return [
            {
                'external_id': c.get('id', ''),
                'name':        c.get('displayName', '') or c.get('number', ''),
                'email':       c.get('email', '') or '',
            }
            for c in items
        ]

    def _customer_id(self, member) -> str:
        if not member or not member.email:
            return ''
        email = member.email.replace("'", "''")
        data = self._get(f"customers?$filter=email eq '{email}'&$top=1")
        items = data.get('value', []) if isinstance(data, dict) else data
        if items:
            return items[0]['id']
        return ''


def _bc_type_to_local(category: str) -> str:
    c = (category or '').lower()
    if 'liab' in c:                     return 'liability'
    if 'equity' in c:                   return 'equity'
    if 'income' in c or 'revenue' in c: return 'revenue'
    if 'expense' in c or 'cost' in c:   return 'expense'
    return 'asset'

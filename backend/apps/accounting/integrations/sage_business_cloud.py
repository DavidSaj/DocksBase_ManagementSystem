"""
apps/accounting/integrations/sage_business_cloud.py

Sage Business Cloud Accounting OAuth2 adapter.

OAuth2 token flow:
  - Access token + refresh token in config.credentials.
  - Business ID stored in config.company_id.
  - Tokens refreshed transparently in _refresh_token_if_needed().

API: https://developer.sage.com/accounting/reference/
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

SAGE_TOKEN_URL = 'https://oauth.accounting.sage.com/token'
SAGE_API_BASE  = 'https://api.accounting.sage.com/v3.1'


class SageBusinessCloudAdapter(AccountingAdapter):
    """Sage Business Cloud Accounting adapter."""

    def _credentials(self) -> dict:
        return self.config.credentials or {}

    def _refresh_token_if_needed(self) -> str:
        creds = self._credentials()
        expires_at = creds.get('expires_at', 0)
        now_ts = datetime.now(tz=timezone.utc).timestamp()
        if now_ts < expires_at - 60:
            return creds['access_token']

        refresh_token = creds.get('refresh_token')
        if not refresh_token:
            raise AdapterError('Sage: no refresh token available. Re-authorise the integration.')

        response = requests.post(
            SAGE_TOKEN_URL,
            data={
                'grant_type':    'refresh_token',
                'refresh_token': refresh_token,
                'client_id':     creds.get('client_id') or settings.SAGE_CLIENT_ID,
                'client_secret': creds.get('client_secret') or settings.SAGE_CLIENT_SECRET,
            },
            timeout=10,
        )
        if response.status_code != 200:
            raise AdapterError(f'Sage token refresh failed: {response.text}')

        token = response.json()
        new_creds = {
            **creds,
            'access_token':  token['access_token'],
            'refresh_token': token.get('refresh_token', refresh_token),
            'expires_at':    now_ts + token.get('expires_in', 300),
        }
        self.config.credentials = new_creds
        self.config.save(update_fields=['credentials'])
        return new_creds['access_token']

    def _headers(self) -> dict:
        h = {
            'Authorization': f'Bearer {self._refresh_token_if_needed()}',
            'Accept':        'application/json',
            'Content-Type':  'application/json',
        }
        if self.config.company_id:
            h['X-Business'] = self.config.company_id
        return h

    def _get(self, path: str) -> dict:
        url = f'{SAGE_API_BASE}/{path}'
        response = requests.get(url, headers=self._headers(), timeout=15)
        if response.status_code == 429:
            raise AdapterRetryableError('Sage rate limit hit.')
        if not response.ok:
            raise AdapterError(f'Sage GET {path} failed: {response.status_code} {response.text}')
        return response.json()

    def _post(self, path: str, payload: dict) -> dict:
        url = f'{SAGE_API_BASE}/{path}'
        response = requests.post(url, headers=self._headers(), json=payload, timeout=15)
        if response.status_code == 429:
            raise AdapterRetryableError('Sage rate limit hit.')
        if not response.ok:
            raise AdapterError(f'Sage POST {path} failed: {response.status_code} {response.text}')
        return response.json()

    # ------------------------------------------------------------------
    # Abstract method implementations
    # ------------------------------------------------------------------

    def test_connection(self) -> bool:
        try:
            self._get('businesses')
            return True
        except requests.Timeout:
            raise AdapterRetryableError('Sage connection timed out.')

    def push_invoice(self, invoice) -> str:
        """Push a sales invoice to Sage. Returns Sage invoice ID."""
        # Sage requires a contact id, so look up or upsert the customer first.
        contact_id = self._upsert_contact(invoice.member) if invoice.member else None
        payload = {
            'sales_invoice': {
                'contact_id':    contact_id,
                'date':          invoice.created_at.date().isoformat() if invoice.created_at else '',
                'due_date':      invoice.due_date.isoformat() if invoice.due_date else '',
                'reference':     invoice.invoice_number,
                'invoice_lines': [
                    {
                        'description':  item.description,
                        'quantity':     float(item.quantity),
                        'unit_price':   float(item.unit_price),
                        'net_amount':   float(item.total_price),
                    }
                    for item in invoice.items.all()
                ],
            }
        }
        result = self._post('sales_invoices', payload)
        sage_id = result['id']
        logger.info('Sage: pushed invoice %s → %s', invoice.invoice_number, sage_id)
        return sage_id

    def push_payment(self, payment) -> str:
        """Push a customer receipt to Sage. Returns Sage payment ID."""
        invoice = payment.invoice
        payload = {
            'contact_payment': {
                'transaction_type_id': 'CUSTOMER_RECEIPT',
                'contact_id':          self._upsert_contact(invoice.member) if invoice.member else '',
                'date':                payment.paid_at.date().isoformat() if payment.paid_at else '',
                'total_amount':        float(payment.amount),
                'reference':           invoice.invoice_number,
            }
        }
        result = self._post('contact_payments', payload)
        sage_id = result['id']
        logger.info('Sage: pushed payment %s → %s', payment.pk, sage_id)
        return sage_id

    def push_journal_entry(self, journal_entry) -> str:
        """Push a manual journal to Sage. Returns Sage journal ID."""
        lines = []
        for line in journal_entry.lines.select_related('account').all():
            lines.append({
                'ledger_account_id': line.account.external_code or line.account.code,
                'details':           line.description or '',
                'debit':             float(line.debit) if line.debit > 0 else 0.0,
                'credit':            float(line.credit) if line.credit > 0 else 0.0,
            })
        payload = {
            'journal': {
                'date':          journal_entry.entry_date.isoformat() if journal_entry.entry_date else '',
                'reference':     journal_entry.reference or f'JE-{journal_entry.pk}',
                'description':   journal_entry.description or '',
                'journal_lines': lines,
            }
        }
        result = self._post('journals', payload)
        sage_id = result['id']
        logger.info('Sage: pushed journal %s → %s', journal_entry.pk, sage_id)
        return sage_id

    def sync_chart_of_accounts(self) -> list:
        data = self._get('ledger_accounts?items_per_page=200')
        items = data.get('$items', []) if isinstance(data, dict) else data
        return [
            {
                'code':          a.get('nominal_code', '') or a.get('displayed_as', ''),
                'name':          a.get('displayed_as', '') or a.get('name', ''),
                'account_type':  _sage_type_to_local(
                    (a.get('ledger_account_classification') or {}).get('displayed_as', '')
                ),
                'external_code': a.get('id', ''),
            }
            for a in items
        ]

    def sync_contacts(self) -> list:
        data = self._get('contacts?items_per_page=200')
        items = data.get('$items', []) if isinstance(data, dict) else data
        return [
            {
                'external_id': c.get('id', ''),
                'name':        c.get('name') or c.get('displayed_as', ''),
                'email':       c.get('email', '') or '',
            }
            for c in items
        ]

    # ------------------------------------------------------------------
    # Internal — contact upsert
    # ------------------------------------------------------------------

    def _upsert_contact(self, member) -> str:
        if member.email:
            data = self._get(f'contacts?search={requests.utils.quote(member.email)}&items_per_page=1')
            items = data.get('$items', []) if isinstance(data, dict) else data
            if items:
                return items[0]['id']
        payload = {
            'contact': {
                'name':           (member.name or member.email or 'Marina Guest')[:200],
                'contact_type_ids': ['CUSTOMER'],
                'main_address': {'address_type_id': 'DELIVERY'},
                'email':          member.email or '',
            }
        }
        created = self._post('contacts', payload)
        return created['id']


def _sage_type_to_local(classification: str) -> str:
    c = (classification or '').lower()
    if 'liab' in c:    return 'liability'
    if 'equity' in c:  return 'equity'
    if 'income' in c or 'revenue' in c or 'sales' in c: return 'revenue'
    if 'expens' in c or 'cost' in c:                    return 'expense'
    return 'asset'

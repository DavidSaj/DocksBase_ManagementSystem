"""
apps/accounting/integrations/xero.py

Xero OAuth2 accounting adapter.

OAuth2 token flow:
  - Access token + refresh token stored in config.credentials (EncryptedJSONField).
  - Token refresh is handled transparently in _get_client().
  - Xero tenant ID stored in config.company_id.

Required pip packages:
  - xero-python (or requests + manual OAuth2)

TODO: Replace the placeholder HTTP calls below with the official xero-python SDK
      once it is added to requirements.txt. The method signatures and return types
      are final — only the HTTP implementation needs to be filled in.
"""

import logging
from datetime import datetime, timezone

import requests

from apps.accounting.integrations.base import AccountingAdapter, AdapterError, AdapterRetryableError

logger = logging.getLogger(__name__)

XERO_TOKEN_URL     = 'https://identity.xero.com/connect/token'
XERO_CONNECTIONS_URL = 'https://api.xero.com/connections'
XERO_API_BASE      = 'https://api.xero.com/api.xro/2.0'


class XeroAdapter(AccountingAdapter):
    """Full Xero OAuth2 adapter implementation."""

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _credentials(self) -> dict:
        return self.config.credentials or {}

    def _refresh_token_if_needed(self) -> str:
        """
        Return a valid access token, refreshing if expired.
        Updates config.credentials atomically.
        """
        creds = self._credentials()
        expires_at = creds.get('expires_at', 0)
        now_ts     = datetime.now(tz=timezone.utc).timestamp()

        if now_ts < expires_at - 60:
            # Token still valid
            return creds['access_token']

        refresh_token = creds.get('refresh_token')
        if not refresh_token:
            raise AdapterError('Xero: no refresh token available. Re-authorise the integration.')

        response = requests.post(
            XERO_TOKEN_URL,
            data={
                'grant_type':    'refresh_token',
                'refresh_token': refresh_token,
                'client_id':     creds.get('client_id', ''),
                'client_secret': creds.get('client_secret', ''),
            },
            timeout=10,
        )
        if response.status_code != 200:
            raise AdapterError(f'Xero token refresh failed: {response.text}')

        token_data = response.json()
        new_creds  = {
            **creds,
            'access_token':  token_data['access_token'],
            'refresh_token': token_data.get('refresh_token', refresh_token),
            'expires_at':    now_ts + token_data.get('expires_in', 1800),
        }
        # Persist updated credentials (encrypted)
        self.config.credentials = new_creds
        self.config.save(update_fields=['credentials'])
        return new_creds['access_token']

    def _headers(self) -> dict:
        return {
            'Authorization': f'Bearer {self._refresh_token_if_needed()}',
            'Xero-tenant-id': self.config.company_id,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        }

    def _get(self, path: str) -> dict:
        url = f'{XERO_API_BASE}/{path}'
        response = requests.get(url, headers=self._headers(), timeout=15)
        if response.status_code == 429:
            raise AdapterRetryableError('Xero rate limit hit.')
        if not response.ok:
            raise AdapterError(f'Xero GET {path} failed: {response.status_code} {response.text}')
        return response.json()

    def _put(self, path: str, payload: dict) -> dict:
        url = f'{XERO_API_BASE}/{path}'
        response = requests.put(url, headers=self._headers(), json=payload, timeout=15)
        if response.status_code == 429:
            raise AdapterRetryableError('Xero rate limit hit.')
        if not response.ok:
            raise AdapterError(f'Xero PUT {path} failed: {response.status_code} {response.text}')
        return response.json()

    # ------------------------------------------------------------------
    # Abstract method implementations
    # ------------------------------------------------------------------

    def test_connection(self) -> bool:
        try:
            response = requests.get(
                XERO_CONNECTIONS_URL,
                headers={'Authorization': f'Bearer {self._refresh_token_if_needed()}'},
                timeout=10,
            )
            if response.status_code == 200:
                return True
            raise AdapterError(f'Xero test_connection failed: {response.status_code}')
        except requests.Timeout:
            raise AdapterRetryableError('Xero connection timed out.')

    def push_invoice(self, invoice) -> str:
        """Push an AR invoice to Xero. Returns Xero InvoiceID."""
        payload = {
            'Type': 'ACCREC',
            'Contact': {'EmailAddress': invoice.member.email if invoice.member else ''},
            'Date': invoice.created_at.date().isoformat() if invoice.created_at else '',
            'DueDate': invoice.due_date.isoformat() if invoice.due_date else '',
            'InvoiceNumber': invoice.invoice_number,
            'LineItems': [
                {
                    'Description':  item.description,
                    'Quantity':     float(item.quantity),
                    'UnitAmount':   float(item.unit_price),
                    'TaxAmount':    float(item.line_tax),
                    'LineAmount':   float(item.total_price),
                }
                for item in invoice.items.all()
            ],
        }
        result = self._put('Invoices', {'Invoices': [payload]})
        xero_id = result['Invoices'][0]['InvoiceID']
        logger.info('Xero: pushed invoice %s → %s', invoice.invoice_number, xero_id)
        return xero_id

    def push_payment(self, payment) -> str:
        """Push a payment to Xero against the linked invoice. Returns Xero PaymentID."""
        invoice = payment.invoice
        payload = {
            'Invoice':  {'InvoiceNumber': invoice.invoice_number},
            'Account':  {'Code': '1010'},   # Bank account code — configurable in future
            'Date':     payment.paid_at.date().isoformat() if payment.paid_at else '',
            'Amount':   float(payment.amount),
        }
        result = self._put('Payments', {'Payments': [payload]})
        xero_id = result['Payments'][0]['PaymentID']
        logger.info('Xero: pushed payment %s → %s', payment.pk, xero_id)
        return xero_id

    def push_journal_entry(self, journal_entry) -> str:
        """Push a manual journal entry to Xero. Returns Xero JournalID."""
        lines = journal_entry.lines.select_related('account').all()
        journal_lines = []
        for line in lines:
            # Xero journals use positive/negative amounts on a single field
            amount = float(line.debit) if line.debit > 0 else -float(line.credit)
            journal_lines.append({
                'AccountCode': line.account.external_code or line.account.code,
                'LineAmount':  amount,
                'Description': line.description,
            })
        payload = {
            'Narration': journal_entry.description or f'JE-{journal_entry.pk}',
            'JournalLines': journal_lines,
        }
        result = self._put('ManualJournals', {'ManualJournals': [payload]})
        xero_id = result['ManualJournals'][0]['ManualJournalID']
        logger.info('Xero: pushed journal entry %s → %s', journal_entry.pk, xero_id)
        return xero_id

    def sync_chart_of_accounts(self) -> list:
        """Pull Xero accounts and return normalised list."""
        data = self._get('Accounts')
        result = []
        for acct in data.get('Accounts', []):
            result.append({
                'code':          acct.get('Code', ''),
                'name':          acct.get('Name', ''),
                'account_type':  _xero_type_to_local(acct.get('Type', '')),
                'external_code': acct.get('AccountID', ''),
            })
        return result

    def sync_contacts(self) -> list:
        """Pull Xero contacts and return normalised list."""
        data = self._get('Contacts')
        result = []
        for contact in data.get('Contacts', []):
            result.append({
                'external_id': contact.get('ContactID', ''),
                'name':        contact.get('Name', ''),
                'email':       contact.get('EmailAddress', ''),
            })
        return result


def _xero_type_to_local(xero_type: str) -> str:
    mapping = {
        'BANK':      'asset',
        'CURRENT':   'asset',
        'FIXED':     'asset',
        'LIABILITY': 'liability',
        'EQUITY':    'equity',
        'REVENUE':   'revenue',
        'DIRECTCOSTS': 'expense',
        'OVERHEADS':   'expense',
        'EXPENSE':     'expense',
    }
    return mapping.get(xero_type.upper(), 'asset')

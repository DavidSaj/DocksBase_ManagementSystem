"""
apps/accounting/integrations/qbo.py

Intuit QuickBooks Online (QBO) OAuth2 adapter.

OAuth2 token flow:
  - Access token + refresh token stored in config.credentials.
  - Realm ID (QBO "company") stored in config.company_id.
  - Tokens are refreshed transparently in _refresh_token_if_needed().

API: QBO Accounting API v3 — https://developer.intuit.com/app/developer/qbapi/docs/api/accounting
"""

import base64
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

QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
QBO_API_BASE_PROD = 'https://quickbooks.api.intuit.com/v3/company'
QBO_API_BASE_SANDBOX = 'https://sandbox-quickbooks.api.intuit.com/v3/company'


def _api_base():
    return QBO_API_BASE_SANDBOX if getattr(settings, 'QBO_SANDBOX', False) else QBO_API_BASE_PROD


class QuickBooksOnlineAdapter(AccountingAdapter):
    """QuickBooks Online OAuth2 adapter."""

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

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
            raise AdapterError('QuickBooks: no refresh token available. Re-authorise the integration.')

        client_id = creds.get('client_id') or settings.QBO_CLIENT_ID
        client_secret = creds.get('client_secret') or settings.QBO_CLIENT_SECRET
        basic = base64.b64encode(f'{client_id}:{client_secret}'.encode()).decode()

        response = requests.post(
            QBO_TOKEN_URL,
            data={'grant_type': 'refresh_token', 'refresh_token': refresh_token},
            headers={
                'Authorization': f'Basic {basic}',
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout=10,
        )
        if response.status_code != 200:
            raise AdapterError(f'QuickBooks token refresh failed: {response.text}')

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
        realm_id = self.config.company_id
        return f'{_api_base()}/{realm_id}/{path}?minorversion=70'

    def _get(self, path: str) -> dict:
        response = requests.get(self._url(path), headers=self._headers(), timeout=15)
        if response.status_code == 429:
            raise AdapterRetryableError('QuickBooks rate limit hit.')
        if not response.ok:
            raise AdapterError(f'QuickBooks GET {path} failed: {response.status_code} {response.text}')
        return response.json()

    def _post(self, path: str, payload: dict) -> dict:
        response = requests.post(self._url(path), headers=self._headers(), json=payload, timeout=15)
        if response.status_code == 429:
            raise AdapterRetryableError('QuickBooks rate limit hit.')
        if not response.ok:
            raise AdapterError(f'QuickBooks POST {path} failed: {response.status_code} {response.text}')
        return response.json()

    # ------------------------------------------------------------------
    # Abstract method implementations
    # ------------------------------------------------------------------

    def test_connection(self) -> bool:
        try:
            self._get('companyinfo/' + self.config.company_id)
            return True
        except requests.Timeout:
            raise AdapterRetryableError('QuickBooks connection timed out.')

    def push_invoice(self, invoice) -> str:
        """Push an AR invoice to QuickBooks Online. Returns the QBO Invoice Id."""
        # Customer must already exist in QBO — look up by email; create if missing.
        customer_ref = self._upsert_customer(invoice.member) if invoice.member else None
        payload = {
            'DocNumber': invoice.invoice_number,
            'TxnDate':   invoice.created_at.date().isoformat() if invoice.created_at else '',
            'DueDate':   invoice.due_date.isoformat() if invoice.due_date else '',
            'CustomerRef': customer_ref or {'value': '1'},  # fall back to QBO "default customer"
            'Line': [
                {
                    'DetailType': 'SalesItemLineDetail',
                    'Amount':     float(item.total_price),
                    'Description': item.description,
                    'SalesItemLineDetail': {
                        'Qty':        float(item.quantity),
                        'UnitPrice':  float(item.unit_price),
                    },
                }
                for item in invoice.items.all()
            ],
        }
        result = self._post('invoice', payload)
        qbo_id = result['Invoice']['Id']
        logger.info('QBO: pushed invoice %s → %s', invoice.invoice_number, qbo_id)
        return qbo_id

    def push_payment(self, payment) -> str:
        """Push a payment receipt to QuickBooks Online. Returns the QBO Payment Id."""
        invoice = payment.invoice
        payload = {
            'TxnDate':     payment.paid_at.date().isoformat() if payment.paid_at else '',
            'TotalAmt':    float(payment.amount),
            'CustomerRef': {'value': self._customer_id_for(invoice.member) if invoice.member else '1'},
            'Line': [
                {
                    'Amount': float(payment.amount),
                    'LinkedTxn': [{
                        'TxnId':   getattr(invoice, 'external_qbo_id', '') or '',
                        'TxnType': 'Invoice',
                    }],
                }
            ],
        }
        result = self._post('payment', payload)
        qbo_id = result['Payment']['Id']
        logger.info('QBO: pushed payment %s → %s', payment.pk, qbo_id)
        return qbo_id

    def push_journal_entry(self, journal_entry) -> str:
        """Push a manual journal entry to QuickBooks Online. Returns the QBO JournalEntry Id."""
        lines = []
        for line in journal_entry.lines.select_related('account').all():
            amount = float(line.debit) if line.debit > 0 else float(line.credit)
            posting_type = 'Debit' if line.debit > 0 else 'Credit'
            lines.append({
                'DetailType': 'JournalEntryLineDetail',
                'Amount': amount,
                'Description': line.description or '',
                'JournalEntryLineDetail': {
                    'PostingType': posting_type,
                    'AccountRef': {'value': line.account.external_code or line.account.code},
                },
            })
        payload = {
            'TxnDate': journal_entry.entry_date.isoformat() if journal_entry.entry_date else '',
            'PrivateNote': journal_entry.description or f'JE-{journal_entry.pk}',
            'Line': lines,
        }
        result = self._post('journalentry', payload)
        qbo_id = result['JournalEntry']['Id']
        logger.info('QBO: pushed journal entry %s → %s', journal_entry.pk, qbo_id)
        return qbo_id

    def sync_chart_of_accounts(self) -> list:
        data = self._get("query?query=" + _q("SELECT * FROM Account"))
        accounts = data.get('QueryResponse', {}).get('Account', [])
        return [
            {
                'code':          a.get('AcctNum', '') or a.get('Id', ''),
                'name':          a.get('Name', ''),
                'account_type':  _qbo_type_to_local(a.get('AccountType', '')),
                'external_code': a.get('Id', ''),
            }
            for a in accounts
        ]

    def sync_contacts(self) -> list:
        data = self._get("query?query=" + _q("SELECT * FROM Customer"))
        customers = data.get('QueryResponse', {}).get('Customer', [])
        return [
            {
                'external_id': c.get('Id', ''),
                'name':        c.get('DisplayName', ''),
                'email':       (c.get('PrimaryEmailAddr') or {}).get('Address', ''),
            }
            for c in customers
        ]

    # ------------------------------------------------------------------
    # Internal — customer cache (very lightweight)
    # ------------------------------------------------------------------

    def _customer_id_for(self, member) -> str:
        email = (member.email or '').replace("'", "''")
        if not email:
            return ''
        sql = "SELECT Id FROM Customer WHERE PrimaryEmailAddr = '" + email + "'"
        data = self._get('query?query=' + _q(sql))
        rows = data.get('QueryResponse', {}).get('Customer', [])
        if rows:
            return rows[0]['Id']
        return ''

    def _upsert_customer(self, member) -> dict:
        existing = self._customer_id_for(member)
        if existing:
            return {'value': existing}
        payload = {
            'DisplayName':       (member.name or member.email or 'Marina Guest')[:100],
            'PrimaryEmailAddr':  {'Address': member.email or ''},
        }
        created = self._post('customer', payload)
        return {'value': created['Customer']['Id']}


def _q(sql: str) -> str:
    """URL-encode a QBO SQL query."""
    from urllib.parse import quote
    return quote(sql)


def _qbo_type_to_local(qbo_type: str) -> str:
    mapping = {
        'Bank':              'asset',
        'Other Current Asset': 'asset',
        'Fixed Asset':       'asset',
        'Other Asset':       'asset',
        'Accounts Receivable': 'asset',
        'Accounts Payable':  'liability',
        'Credit Card':       'liability',
        'Long Term Liability': 'liability',
        'Other Current Liability': 'liability',
        'Equity':            'equity',
        'Income':            'revenue',
        'Other Income':      'revenue',
        'Expense':           'expense',
        'Other Expense':     'expense',
        'Cost of Goods Sold': 'expense',
    }
    return mapping.get(qbo_type, 'asset')

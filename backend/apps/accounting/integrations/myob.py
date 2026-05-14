"""
apps/accounting/integrations/myob.py

MYOB AccountRight Live OAuth2 adapter (Australia / New Zealand).

API: https://developer.myob.com/api/myob-business-api/
Auth: OAuth2 authorization code with offline access; tokens refreshed via
      _refresh_token_if_needed().

self.config.company_id stores the full company-file URI as returned by
MYOB's /Info endpoint (e.g. https://api.myob.com/accountright/<guid>).
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

MYOB_TOKEN_URL = 'https://secure.myob.com/oauth2/v1/authorize'


class MYOBAdapter(AccountingAdapter):
    """MYOB AccountRight Live adapter."""

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
            raise AdapterError('MYOB: no refresh token available. Re-authorise the integration.')

        response = requests.post(
            MYOB_TOKEN_URL,
            data={
                'grant_type':    'refresh_token',
                'refresh_token': refresh_token,
                'client_id':     creds.get('client_id') or settings.MYOB_CLIENT_ID,
                'client_secret': creds.get('client_secret') or settings.MYOB_CLIENT_SECRET,
            },
            timeout=10,
        )
        if response.status_code != 200:
            raise AdapterError(f'MYOB token refresh failed: {response.text}')

        token = response.json()
        new_creds = {
            **creds,
            'access_token':  token['access_token'],
            'refresh_token': token.get('refresh_token', refresh_token),
            'expires_at':    now_ts + token.get('expires_in', 1200),
        }
        self.config.credentials = new_creds
        self.config.save(update_fields=['credentials'])
        return new_creds['access_token']

    def _headers(self) -> dict:
        return {
            'Authorization':     f'Bearer {self._refresh_token_if_needed()}',
            'x-myobapi-key':     settings.MYOB_CLIENT_ID,
            'x-myobapi-version': 'v2',
            'Accept':            'application/json',
            'Content-Type':      'application/json',
        }

    def _company_url(self, path: str) -> str:
        company = self.config.company_id
        return f'{company.rstrip("/")}/{path}'

    def _get(self, path: str) -> dict:
        response = requests.get(self._company_url(path), headers=self._headers(), timeout=15)
        if response.status_code == 429:
            raise AdapterRetryableError('MYOB rate limit hit.')
        if not response.ok:
            raise AdapterError(f'MYOB GET {path} failed: {response.status_code} {response.text}')
        return response.json()

    def _post(self, path: str, payload: dict) -> dict:
        response = requests.post(
            self._company_url(path),
            headers=self._headers(),
            json=payload,
            timeout=15,
        )
        if response.status_code == 429:
            raise AdapterRetryableError('MYOB rate limit hit.')
        if not response.ok:
            raise AdapterError(f'MYOB POST {path} failed: {response.status_code} {response.text}')
        loc = response.headers.get('Location')
        if loc:
            return requests.get(loc, headers=self._headers(), timeout=10).json()
        return response.json() if response.content else {}

    # ------------------------------------------------------------------
    # Abstract method implementations
    # ------------------------------------------------------------------

    def test_connection(self) -> bool:
        try:
            self._get('CompanyFile')
            return True
        except requests.Timeout:
            raise AdapterRetryableError('MYOB connection timed out.')

    def push_invoice(self, invoice) -> str:
        payload = {
            'Number':   invoice.invoice_number,
            'Date':     invoice.created_at.date().isoformat() if invoice.created_at else '',
            'Customer': {'UID': self._customer_uid(invoice.member)} if invoice.member else None,
            'Lines': [
                {'Description': item.description, 'Total': float(item.total_price)}
                for item in invoice.items.all()
            ],
        }
        result = self._post('Sale/Invoice/Service', payload)
        return result.get('UID', '')

    def push_payment(self, payment) -> str:
        invoice = payment.invoice
        payload = {
            'Date':           payment.paid_at.date().isoformat() if payment.paid_at else '',
            'AmountReceived': float(payment.amount),
            'Customer':       {'UID': self._customer_uid(invoice.member)} if invoice.member else None,
            'Invoices': [{
                'UID': getattr(invoice, 'external_myob_id', ''),
                'AmountApplied': float(payment.amount),
            }],
        }
        result = self._post('Sale/CustomerPayment', payload)
        return result.get('UID', '')

    def push_journal_entry(self, journal_entry) -> str:
        lines = []
        for line in journal_entry.lines.select_related('account').all():
            lines.append({
                'Account':  {'UID': line.account.external_code or line.account.code},
                'IsCredit': line.credit > 0,
                'Amount':   float(line.debit) if line.debit > 0 else float(line.credit),
                'Memo':     (line.description or '')[:255],
            })
        payload = {
            'DateOccurred': journal_entry.entry_date.isoformat() if journal_entry.entry_date else '',
            'Memo':         (journal_entry.description or '')[:255],
            'Lines':        lines,
        }
        result = self._post('GeneralLedger/GeneralJournal', payload)
        return result.get('UID', '')

    def sync_chart_of_accounts(self) -> list:
        data = self._get('GeneralLedger/Account?$top=1000')
        items = data.get('Items', []) if isinstance(data, dict) else data
        return [
            {
                'code':          a.get('DisplayID', '') or a.get('Number', ''),
                'name':          a.get('Name', ''),
                'account_type':  _myob_type_to_local(a.get('Type', '')),
                'external_code': a.get('UID', ''),
            }
            for a in items
        ]

    def sync_contacts(self) -> list:
        data = self._get('Contact/Customer?$top=1000')
        items = data.get('Items', []) if isinstance(data, dict) else data
        return [
            {
                'external_id': c.get('UID', ''),
                'name':        c.get('CompanyName') or f"{c.get('FirstName', '')} {c.get('LastName', '')}".strip(),
                'email':       (c.get('EmailAddress') or '').strip(),
            }
            for c in items
        ]

    def _customer_uid(self, member) -> str:
        if not member or not member.email:
            return ''
        data = self._get(f"Contact/Customer?$filter=EmailAddress eq '{member.email}'")
        items = data.get('Items', []) if isinstance(data, dict) else data
        if items:
            return items[0]['UID']
        return ''


def _myob_type_to_local(myob_type: str) -> str:
    mapping = {
        'Bank':                    'asset',
        'Asset':                   'asset',
        'OtherAsset':              'asset',
        'OtherCurrentAsset':       'asset',
        'AccountReceivable':       'asset',
        'FixedAsset':              'asset',
        'Liability':               'liability',
        'AccountPayable':          'liability',
        'CreditCard':              'liability',
        'OtherCurrentLiability':   'liability',
        'LongTermLiability':       'liability',
        'Equity':                  'equity',
        'Income':                  'revenue',
        'OtherIncome':             'revenue',
        'CostOfSales':             'expense',
        'Expense':                 'expense',
        'OtherExpense':            'expense',
    }
    return mapping.get(myob_type, 'asset')

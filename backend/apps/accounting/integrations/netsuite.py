"""
apps/accounting/integrations/netsuite.py

Oracle NetSuite OAuth2 adapter using the REST Web Services API (SuiteTalk REST).

config.company_id stores the NetSuite Account ID (e.g. "TSTDRV1234567" or
                  "5678901_SB1"). The account ID determines the API subdomain.
config.base_url  unused — REST URL is built from account_id.

API docs: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157771733782.html
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


def _account_subdomain(account_id: str) -> str:
    """NetSuite normalizes Account IDs into hostnames by lowercasing and
    replacing underscores with hyphens. e.g. TSTDRV_12345 → tstdrv-12345."""
    return account_id.lower().replace('_', '-')


def _rest_base(account_id: str) -> str:
    return f'https://{_account_subdomain(account_id)}.suitetalk.api.netsuite.com/services/rest/record/v1'


def _token_url(account_id: str) -> str:
    return f'https://{_account_subdomain(account_id)}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token'


class NetSuiteAdapter(AccountingAdapter):
    """Oracle NetSuite OAuth2 adapter (SuiteTalk REST)."""

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
            raise AdapterError('NetSuite: no refresh token available. Re-authorise.')

        response = requests.post(
            _token_url(self.config.company_id),
            data={
                'grant_type':    'refresh_token',
                'refresh_token': refresh_token,
            },
            auth=(
                creds.get('client_id')     or settings.NETSUITE_CLIENT_ID,
                creds.get('client_secret') or settings.NETSUITE_CLIENT_SECRET,
            ),
            timeout=10,
        )
        if response.status_code != 200:
            raise AdapterError(f'NetSuite token refresh failed: {response.text}')

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
        return f'{_rest_base(self.config.company_id)}/{path}'

    def _get(self, path: str) -> dict:
        response = requests.get(self._url(path), headers=self._headers(), timeout=15)
        if response.status_code == 429:
            raise AdapterRetryableError('NetSuite rate limit hit.')
        if not response.ok:
            raise AdapterError(f'NetSuite GET {path} failed: {response.status_code} {response.text}')
        return response.json()

    def _post(self, path: str, payload: dict) -> str:
        response = requests.post(self._url(path), headers=self._headers(), json=payload, timeout=15)
        if response.status_code == 429:
            raise AdapterRetryableError('NetSuite rate limit hit.')
        if response.status_code not in (200, 201, 204):
            raise AdapterError(f'NetSuite POST {path} failed: {response.status_code} {response.text}')
        # NetSuite returns the created resource id in the Location header.
        loc = response.headers.get('Location', '')
        return loc.rsplit('/', 1)[-1] if loc else (response.json() if response.content else {}).get('id', '')

    # ------------------------------------------------------------------
    # Abstract method implementations
    # ------------------------------------------------------------------

    def test_connection(self) -> bool:
        try:
            self._get('account?limit=1')
            return True
        except requests.Timeout:
            raise AdapterRetryableError('NetSuite connection timed out.')

    def push_invoice(self, invoice) -> str:
        customer_id = self._customer_id(invoice.member) if invoice.member else None
        payload = {
            'entity':     {'id': customer_id} if customer_id else None,
            'tranDate':   invoice.created_at.date().isoformat() if invoice.created_at else None,
            'dueDate':    invoice.due_date.isoformat() if invoice.due_date else None,
            'tranId':     invoice.invoice_number,
            'item': {
                'items': [
                    {
                        'description': item.description,
                        'quantity':    float(item.quantity),
                        'rate':        float(item.unit_price),
                    }
                    for item in invoice.items.all()
                ],
            },
        }
        ns_id = self._post('invoice', payload)
        logger.info('NetSuite: pushed invoice %s → %s', invoice.invoice_number, ns_id)
        return ns_id

    def push_payment(self, payment) -> str:
        invoice = payment.invoice
        payload = {
            'customer':   {'id': self._customer_id(invoice.member)} if invoice.member else None,
            'tranDate':   payment.paid_at.date().isoformat() if payment.paid_at else None,
            'payment':    float(payment.amount),
            'memo':       f'Payment for {invoice.invoice_number}',
        }
        ns_id = self._post('customerPayment', payload)
        logger.info('NetSuite: pushed payment %s → %s', payment.pk, ns_id)
        return ns_id

    def push_journal_entry(self, journal_entry) -> str:
        line_items = []
        for line in journal_entry.lines.select_related('account').all():
            line_items.append({
                'account': {'refName': line.account.name, 'id': line.account.external_code or line.account.code},
                'debit':   float(line.debit)  if line.debit  > 0 else None,
                'credit':  float(line.credit) if line.credit > 0 else None,
                'memo':    (line.description or '')[:100],
            })
        payload = {
            'tranDate':   journal_entry.entry_date.isoformat() if journal_entry.entry_date else None,
            'tranId':     journal_entry.reference or f'JE-{journal_entry.pk}',
            'memo':       (journal_entry.description or '')[:100],
            'line':       {'items': line_items},
        }
        ns_id = self._post('journalEntry', payload)
        logger.info('NetSuite: pushed journal %s → %s', journal_entry.pk, ns_id)
        return ns_id

    def sync_chart_of_accounts(self) -> list:
        data = self._get('account?limit=1000')
        items = data.get('items', []) if isinstance(data, dict) else data
        return [
            {
                'code':          a.get('acctNumber', '') or a.get('id', ''),
                'name':          a.get('acctName', '') or a.get('displayName', ''),
                'account_type':  _ns_type_to_local(a.get('acctType', '')),
                'external_code': a.get('id', ''),
            }
            for a in items
        ]

    def sync_contacts(self) -> list:
        data = self._get('customer?limit=1000')
        items = data.get('items', []) if isinstance(data, dict) else data
        return [
            {
                'external_id': c.get('id', ''),
                'name':        c.get('companyName') or c.get('entityId', ''),
                'email':       (c.get('email') or '').strip(),
            }
            for c in items
        ]

    def _customer_id(self, member) -> str:
        if not member or not member.email:
            return ''
        data = self._get(f"customer?q=email IS \"{member.email}\"&limit=1")
        items = data.get('items', []) if isinstance(data, dict) else data
        if items:
            return items[0]['id']
        return ''


def _ns_type_to_local(ns_type: str) -> str:
    """Map NetSuite acctType codes to local categories."""
    asset_types     = {'Bank', 'AcctRec', 'OthCurrAsset', 'FixedAsset', 'OthAsset'}
    liability_types = {'AcctPay', 'CredCard', 'OthCurrLiab', 'LongTermLiab'}
    if ns_type in asset_types:     return 'asset'
    if ns_type in liability_types: return 'liability'
    if ns_type == 'Equity':        return 'equity'
    if ns_type == 'Income':        return 'revenue'
    if ns_type == 'OthIncome':     return 'revenue'
    if ns_type == 'COGS':          return 'expense'
    if ns_type == 'Expense':       return 'expense'
    if ns_type == 'OthExpense':    return 'expense'
    return 'asset'

"""
apps/accounting/integrations/netsuite.py

Oracle NetSuite adapter stub.
All methods raise NotImplementedError until this integration is implemented.
"""

from apps.accounting.integrations.base import AccountingAdapter


class NetSuiteAdapter(AccountingAdapter):
    """Stub adapter for Oracle NetSuite. Not yet implemented."""

    def test_connection(self) -> bool:
        raise NotImplementedError("NetSuite integration is not yet implemented.")

    def push_invoice(self, invoice) -> str:
        raise NotImplementedError("NetSuite integration is not yet implemented.")

    def push_payment(self, payment) -> str:
        raise NotImplementedError("NetSuite integration is not yet implemented.")

    def push_journal_entry(self, journal_entry) -> str:
        raise NotImplementedError("NetSuite integration is not yet implemented.")

    def sync_chart_of_accounts(self) -> list:
        raise NotImplementedError("NetSuite integration is not yet implemented.")

    def sync_contacts(self) -> list:
        raise NotImplementedError("NetSuite integration is not yet implemented.")

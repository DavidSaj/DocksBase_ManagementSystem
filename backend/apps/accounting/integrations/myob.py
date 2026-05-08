"""
apps/accounting/integrations/myob.py

MYOB adapter stub.
All methods raise NotImplementedError until this integration is implemented.
"""

from apps.accounting.integrations.base import AccountingAdapter


class MYOBAdapter(AccountingAdapter):
    """Stub adapter for MYOB. Not yet implemented."""

    def test_connection(self) -> bool:
        raise NotImplementedError("MYOB integration is not yet implemented.")

    def push_invoice(self, invoice) -> str:
        raise NotImplementedError("MYOB integration is not yet implemented.")

    def push_payment(self, payment) -> str:
        raise NotImplementedError("MYOB integration is not yet implemented.")

    def push_journal_entry(self, journal_entry) -> str:
        raise NotImplementedError("MYOB integration is not yet implemented.")

    def sync_chart_of_accounts(self) -> list:
        raise NotImplementedError("MYOB integration is not yet implemented.")

    def sync_contacts(self) -> list:
        raise NotImplementedError("MYOB integration is not yet implemented.")

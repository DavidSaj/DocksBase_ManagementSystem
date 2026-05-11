"""
apps/accounting/integrations/sage_intacct.py

Sage Intacct adapter stub.
All methods raise NotImplementedError until this integration is implemented.
"""

from apps.accounting.integrations.base import AccountingAdapter


class SageIntacctAdapter(AccountingAdapter):
    """Stub adapter for Sage Intacct. Not yet implemented."""

    def test_connection(self) -> bool:
        raise NotImplementedError("Sage Intacct integration is not yet implemented.")

    def push_invoice(self, invoice) -> str:
        raise NotImplementedError("Sage Intacct integration is not yet implemented.")

    def push_payment(self, payment) -> str:
        raise NotImplementedError("Sage Intacct integration is not yet implemented.")

    def push_journal_entry(self, journal_entry) -> str:
        raise NotImplementedError("Sage Intacct integration is not yet implemented.")

    def sync_chart_of_accounts(self) -> list:
        raise NotImplementedError("Sage Intacct integration is not yet implemented.")

    def sync_contacts(self) -> list:
        raise NotImplementedError("Sage Intacct integration is not yet implemented.")

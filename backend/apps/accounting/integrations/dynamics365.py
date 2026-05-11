"""
apps/accounting/integrations/dynamics365.py

Microsoft Dynamics 365 Business Central adapter stub.
All methods raise NotImplementedError until this integration is implemented.
"""

from apps.accounting.integrations.base import AccountingAdapter


class Dynamics365Adapter(AccountingAdapter):
    """Stub adapter for Microsoft Dynamics 365 Business Central. Not yet implemented."""

    def test_connection(self) -> bool:
        raise NotImplementedError("Dynamics 365 integration is not yet implemented.")

    def push_invoice(self, invoice) -> str:
        raise NotImplementedError("Dynamics 365 integration is not yet implemented.")

    def push_payment(self, payment) -> str:
        raise NotImplementedError("Dynamics 365 integration is not yet implemented.")

    def push_journal_entry(self, journal_entry) -> str:
        raise NotImplementedError("Dynamics 365 integration is not yet implemented.")

    def sync_chart_of_accounts(self) -> list:
        raise NotImplementedError("Dynamics 365 integration is not yet implemented.")

    def sync_contacts(self) -> list:
        raise NotImplementedError("Dynamics 365 integration is not yet implemented.")

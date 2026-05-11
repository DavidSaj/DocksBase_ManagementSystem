"""
apps/accounting/integrations/base.py

Abstract base class for all accounting platform adapters.
Each adapter must implement all abstract methods.
"""

from abc import ABC, abstractmethod


class AdapterError(Exception):
    """Non-retryable adapter error (auth failure, data validation, etc.)."""


class AdapterRetryableError(Exception):
    """
    Transient error that may succeed on retry (rate limit, network timeout, etc.).
    Tasks using this adapter should catch this and use Celery's retry mechanism.
    """


class AccountingAdapter(ABC):
    """
    Abstract base for all accounting platform adapters.

    Each adapter is initialised with an AccountingIntegrationConfig instance.
    Credentials are read from config.credentials (EncryptedJSONField).
    """

    def __init__(self, config):
        """
        Args:
            config: AccountingIntegrationConfig instance.
        """
        self.config = config

    @abstractmethod
    def test_connection(self) -> bool:
        """
        Verify connectivity and auth against the external platform.
        Returns True on success.
        Raises AdapterError on non-retryable failure.
        Raises AdapterRetryableError on transient failure.
        """

    @abstractmethod
    def push_invoice(self, invoice) -> str:
        """
        Push a billing.Invoice to the external platform.
        Returns the external invoice ID.
        """

    @abstractmethod
    def push_payment(self, payment) -> str:
        """
        Push a billing.Payment to the external platform.
        Returns the external payment ID.
        """

    @abstractmethod
    def push_journal_entry(self, journal_entry) -> str:
        """
        Push an accounting.JournalEntry to the external platform.
        Returns the external journal entry ID.
        """

    @abstractmethod
    def sync_chart_of_accounts(self) -> list:
        """
        Pull the chart of accounts from the external platform.
        Returns a list of dicts with keys: code, name, account_type, external_code.
        """

    @abstractmethod
    def sync_contacts(self) -> list:
        """
        Pull member/supplier contacts from the external platform.
        Returns a list of dicts with keys: external_id, name, email.
        """

"""
ESignProvider — abstract interface every e-signature backend implements.

Each method maps to one operation the rest of the app needs: creating a
template draft from an uploaded PDF, sending a templated envelope to a
member, fetching the signed PDF after completion, and the two embedded-sign
URL flows used by the boater portal check-in screen.

Subclasses receive the marina object in `__init__` and pull whatever
credentials they need from it (api keys, account ids, private keys, etc).
"""
from __future__ import annotations

from abc import ABC, abstractmethod


class ESignProvider(ABC):
    """A single marina's connection to one e-signature SaaS."""

    def __init__(self, marina):
        self.marina = marina

    @abstractmethod
    def create_embedded_template_draft(self, template, file_path: str) -> str:
        """
        Upload the PDF at `file_path` and start a template-creation session.
        Returns a one-time edit URL the manager opens in an iframe to set up
        signer roles, fields, and tabs.
        """

    @abstractmethod
    def send_envelope(self, envelope) -> str:
        """
        Send a new envelope for signature using the template referenced by
        `envelope.template`. Returns the provider's request/envelope id.
        """

    @abstractmethod
    def get_signed_pdf_url(self, request_id: str) -> str:
        """Return a short-lived URL the manager can use to download the signed PDF."""

    @abstractmethod
    def create_embedded_sign_url(
        self, booking, template_id: str, *, envelope_pk=None,
    ) -> tuple[str, str]:
        """
        Create an embedded signature request for the boater waiver and return
        `(request_id, sign_url)`. The boater portal opens `sign_url` in an iframe.
        """

    @abstractmethod
    def get_existing_embedded_sign_url(self, request_id: str) -> str:
        """Re-issue the embedded sign URL for an existing request (e.g. on page reload)."""

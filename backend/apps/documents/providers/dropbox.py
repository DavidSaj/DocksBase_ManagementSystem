"""
DropboxSignProvider — wraps the dropbox_sign SDK behind the ESignProvider
interface. Lifted verbatim from the pre-refactor module-level functions in
`apps.documents.services`; logic is unchanged.
"""
from __future__ import annotations

from django.conf import settings

from .base import ESignProvider

try:
    import dropbox_sign
except ImportError:
    dropbox_sign = None  # type: ignore[assignment]


class DropboxSignProvider(ESignProvider):
    def _api_client(self):
        api_key = self.marina.dropboxsign_api_key or getattr(settings, 'DROPBOX_SIGN_API_KEY', '')
        configuration = dropbox_sign.Configuration(username=api_key)
        return dropbox_sign.ApiClient(configuration)

    def _client_id(self) -> str:
        return self.marina.dropboxsign_client_id or getattr(settings, 'DROPBOX_SIGN_CLIENT_ID', '')

    def create_embedded_template_draft(self, template, file_path: str) -> str:
        with self._api_client() as client:
            api = dropbox_sign.TemplateApi(client)
            data = dropbox_sign.EmbeddedCreateEmbeddedTemplateDraftRequest(
                client_id=self._client_id(),
                files=[file_path],
                title=template.name,
                signer_roles=[{'name': 'Member', 'order': 0}],
                metadata={
                    'marina_id': str(template.marina_id),
                    'template_pk': str(template.pk),
                },
            )
            result = api.create_embedded_template_draft(data)
            return result.embedded_template.edit_url

    def send_envelope(self, envelope) -> str:
        with self._api_client() as client:
            api = dropbox_sign.SignatureRequestApi(client)
            signer = dropbox_sign.SubSignatureRequestTemplateSigner(
                role='Member',
                name=envelope.recipient.name,
                email_address=envelope.recipient.email,
            )
            data = dropbox_sign.SignatureRequestSendWithTemplateRequest(
                template_ids=[envelope.template.dropboxsign_template_id],
                signers=[signer],
                metadata={
                    'marina_id': str(envelope.marina_id),
                    'envelope_pk': str(envelope.pk),
                },
            )
            result = api.send_with_template(data)
            return result.signature_request.signature_request_id

    def get_signed_pdf_url(self, request_id: str) -> str:
        with self._api_client() as client:
            api = dropbox_sign.SignatureRequestApi(client)
            result = api.get(request_id)
            return result.signature_request.signing_url

    def create_embedded_sign_url(
        self, booking, template_id: str, *, envelope_pk=None,
    ) -> tuple[str, str]:
        with self._api_client() as client:
            sig_api      = dropbox_sign.SignatureRequestApi(client)
            embedded_api = dropbox_sign.EmbeddedApi(client)

            metadata = {'booking_id': str(booking.id)}
            if envelope_pk is not None:
                metadata['envelope_pk'] = str(envelope_pk)

            data = dropbox_sign.SignatureRequestCreateEmbeddedWithTemplateRequest(
                client_id=self._client_id(),
                template_ids=[template_id],
                subject='Marina Waiver',
                signers=[
                    dropbox_sign.SubSignatureRequestTemplateSigner(
                        role='Boater',
                        name=booking.guest_name or 'Boater',
                        email_address=booking.guest_email,
                    )
                ],
                metadata=metadata,
            )
            sig_response  = sig_api.signature_request_create_embedded_with_template(data)
            request_id    = sig_response.signature_request.signature_request_id
            signature_id  = sig_response.signature_request.signatures[0].signature_id
            url_response  = embedded_api.embedded_sign_url(signature_id)
            return request_id, url_response.embedded.sign_url

    def get_existing_embedded_sign_url(self, request_id: str) -> str:
        with self._api_client() as client:
            sig_api      = dropbox_sign.SignatureRequestApi(client)
            embedded_api = dropbox_sign.EmbeddedApi(client)
            sig_response = sig_api.signature_request_get(request_id)
            signature_id = sig_response.signature_request.signatures[0].signature_id
            url_response = embedded_api.embedded_sign_url(signature_id)
            return url_response.embedded.sign_url

from django.conf import settings

# Imported lazily so tests can patch without installing the SDK.
# In production, `pip install dropbox-sign` must be run first.
try:
    import dropbox_sign
except ImportError:
    dropbox_sign = None  # type: ignore[assignment]


def _api_client():
    configuration = dropbox_sign.Configuration(username=settings.DROPBOX_SIGN_API_KEY)
    return dropbox_sign.ApiClient(configuration)


def create_embedded_template_draft(template, file_path: str) -> str:
    """Upload PDF to Dropbox Sign embedded editor. Returns edit_url.

    The Dropbox Sign SDK accepts a file path string or a file-like object
    for the `files` parameter; passing the path string directly avoids
    holding an open file handle across the API call.
    """
    with _api_client() as client:
        api = dropbox_sign.TemplateApi(client)
        data = dropbox_sign.EmbeddedCreateEmbeddedTemplateDraftRequest(
            client_id=settings.DROPBOX_SIGN_CLIENT_ID,
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


def send_envelope(envelope) -> str:
    """Send signature request. Returns dropboxsign_request_id."""
    with _api_client() as client:
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


def get_signed_pdf_url(signature_request_id: str) -> str:
    """Fetch the signed PDF download URL from Dropbox Sign."""
    with _api_client() as client:
        api = dropbox_sign.SignatureRequestApi(client)
        result = api.get(signature_request_id)
        return result.signature_request.signing_url

"""
E-signature service layer.

Public API (unchanged from the original module-level functions, so callers
in apps.documents.views and apps.portal.checkin_views keep working):

    create_embedded_template_draft(template, file_path, *, marina) -> edit_url
    send_envelope(envelope, *, marina) -> request_id_or_envelope_id
    get_signed_pdf_url(envelope_or_request_id, *, marina) -> url
    create_embedded_sign_url(booking, template_id, *, marina, envelope_pk=None)
        -> (request_id, sign_url)
    get_existing_embedded_sign_url(envelope_or_request_id, *, marina) -> url

Behind the scenes each function picks a provider via `_provider_for(...)`
and delegates. Today only DropboxSignProvider is implemented; DocuSignProvider
lives in `.providers.docusign` and will be wired in once we ship the JWT auth
work.
"""
from __future__ import annotations

from .providers.base   import ESignProvider
from .providers.dropbox import DropboxSignProvider
from .providers.docusign import DocuSignProvider


def _provider_for_template(template) -> ESignProvider:
    return _provider(template.provider, template.marina)


def _provider_for_envelope(envelope) -> ESignProvider:
    return _provider(envelope.provider, envelope.marina)


def _provider(provider_key: str, marina) -> ESignProvider:
    if provider_key == 'docusign':
        return DocuSignProvider(marina)
    return DropboxSignProvider(marina)


def create_embedded_template_draft(template, file_path: str, *, api_key: str = '', client_id: str = '') -> str:
    """
    NOTE: `api_key`/`client_id` kept as keyword args for backward compatibility
    with the existing caller in `apps.documents.views`. They are ignored — the
    provider reads credentials from `template.marina`.
    """
    return _provider_for_template(template).create_embedded_template_draft(template, file_path)


def send_envelope(envelope, *, api_key: str = '', client_id: str = '') -> str:
    return _provider_for_envelope(envelope).send_envelope(envelope)


def get_signed_pdf_url(envelope_or_request_id, *, api_key: str = '', marina=None) -> str:
    """
    Backward-compatible: callers pass a raw request_id and the dropboxsign
    api_key. We accept that, or a richer (envelope, marina) call. If only
    request_id is provided we cannot know the provider, so we default to
    Dropbox Sign — matching previous behavior.
    """
    from apps.documents.models import Envelope
    if hasattr(envelope_or_request_id, 'provider'):
        env = envelope_or_request_id
        return _provider_for_envelope(env).get_signed_pdf_url(env.provider_request_id())
    # Legacy path
    env = Envelope.objects.filter(dropboxsign_request_id=envelope_or_request_id).first()
    if env:
        return _provider_for_envelope(env).get_signed_pdf_url(envelope_or_request_id)
    if marina:
        return DropboxSignProvider(marina).get_signed_pdf_url(envelope_or_request_id)
    raise ValueError('marina argument is required for legacy get_signed_pdf_url call.')


def create_embedded_sign_url(
    booking,
    template_id: str,
    *,
    api_key: str = '',
    client_id: str = '',
    envelope_pk=None,
    marina=None,
    provider_key: str = 'dropboxsign',
) -> tuple[str, str]:
    """
    Boater-waiver path. Caller must pass either `marina` (preferred) or fall
    back to legacy positional. `provider_key` selects which provider to use.
    """
    marina = marina or getattr(booking, 'marina', None)
    if marina is None:
        raise ValueError('marina is required for create_embedded_sign_url.')
    return _provider(provider_key, marina).create_embedded_sign_url(
        booking, template_id, envelope_pk=envelope_pk,
    )


def get_existing_embedded_sign_url(envelope_or_request_id, *, api_key: str = '', marina=None,
                                   provider_key: str = 'dropboxsign') -> str:
    from apps.documents.models import Envelope
    if hasattr(envelope_or_request_id, 'provider'):
        env = envelope_or_request_id
        return _provider_for_envelope(env).get_existing_embedded_sign_url(env.provider_request_id())
    env = Envelope.objects.filter(dropboxsign_request_id=envelope_or_request_id).first()
    if env:
        return _provider_for_envelope(env).get_existing_embedded_sign_url(envelope_or_request_id)
    if marina is None:
        raise ValueError('marina argument is required for legacy call.')
    return _provider(provider_key, marina).get_existing_embedded_sign_url(envelope_or_request_id)

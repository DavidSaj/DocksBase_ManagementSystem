"""Email helpers for document-expiry notifications."""

import logging

from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)


def send_document_expiry_email(member_doc):
    """
    Notify a member that their document is expiring within 30 days.
    Pure send — rule-gating happens in the caller (the management command).
    """
    if not member_doc.member or not member_doc.member.email:
        logger.info('document_expiry: doc %s has no member email, skipping', member_doc.pk)
        return

    marina = member_doc.marina
    doc_label = member_doc.get_doc_type_display()
    greeting = (member_doc.member.name.split()[0] if member_doc.member.name else 'there')
    expiry_fmt = member_doc.expiry_date.strftime('%d %B %Y') if member_doc.expiry_date else 'soon'

    body = (
        f"Hi {greeting},\n\n"
        f"Your {doc_label.lower()} document on file with {marina.name} expires on "
        f"{expiry_fmt}. To keep your berth in good standing, please upload a "
        f"renewed copy before that date.\n\n"
        f"You can upload directly from your account portal.\n\n"
        f"Thanks,\n"
        f"— {marina.name}"
    )

    try:
        send_mail(
            subject=f"{doc_label} expires soon — {marina.name}",
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[member_doc.member.email],
            fail_silently=False,
        )
        logger.info(
            'document_expiry: emailed member %s about %s doc %s',
            member_doc.member_id, doc_label, member_doc.pk,
        )
    except Exception as exc:
        logger.exception(
            'document_expiry: send failed for doc %s: %s', member_doc.pk, exc,
        )

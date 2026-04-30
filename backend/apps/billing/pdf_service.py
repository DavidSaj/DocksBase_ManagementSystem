import logging

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.mail import EmailMessage
from django.template.loader import render_to_string

from .models import Invoice

logger = logging.getLogger(__name__)

try:
    from weasyprint import HTML
except OSError:
    # WeasyPrint requires native GTK/Pango libraries which may not be present in all
    # environments (e.g. local Windows dev). The real implementation is used in
    # production (Linux). Tests mock this name directly.
    HTML = None  # type: ignore[assignment,misc]


def _generate_store_and_email_pdf(invoice_id):
    try:
        invoice = Invoice.objects.select_related('marina', 'member').prefetch_related('items').get(pk=invoice_id)
        html_string = render_to_string('billing/invoice_pdf.html', {'invoice': invoice})
        pdf_bytes = HTML(string=html_string).write_pdf()

        path = f'invoices/{invoice.marina_id}/{invoice.invoice_number}.pdf'
        saved_path = default_storage.save(path, ContentFile(pdf_bytes))
        invoice.pdf_document = saved_path
        invoice.save(update_fields=['pdf_document'])

        if invoice.member and invoice.member.email:
            doc_type = 'Receipt' if invoice.status == 'paid' else 'Invoice'
            msg = EmailMessage(
                subject=f'DocksBase {doc_type} {invoice.invoice_number}',
                body=(
                    f'Dear {invoice.member.name},\n\n'
                    f'Please find your {doc_type.lower()} attached.\n\n'
                    f'DocksBase'
                ),
                to=[invoice.member.email],
            )
            msg.attach(f'{invoice.invoice_number}.pdf', pdf_bytes, 'application/pdf')
            msg.send(fail_silently=True)
    except Exception:
        logger.exception('PDF generation failed for invoice %s', invoice_id)

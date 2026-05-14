"""
Marina-wide data export.

A manager clicks "Request Export" → a DataExport row is created → this
Celery task gathers every marina-scoped row across the main domains into
a zip of CSV files, uploads it to default storage, and emails the
requester a signed URL.

The job is intentionally read-only and survives partial failures: if one
entity errors out, the file still contains everything else plus an
errors.txt note. We never block the marina's operational data on a
failed export.

GDPR scope: this is the marina's own operational data, not an end-user
personal-data export — it's intended to give the marina manager a
portable copy of their book of business.
"""

import csv
import io
import logging
import zipfile
from datetime import datetime, timedelta, timezone

from celery import shared_task
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.utils import timezone as django_tz

logger = logging.getLogger(__name__)

EXPORT_TTL_DAYS = 7


def _csv_bytes(rows, fieldnames):
    """Render rows (list of dicts) → utf-8 CSV bytes."""
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction='ignore')
    writer.writeheader()
    for r in rows:
        writer.writerow({k: ('' if v is None else v) for k, v in r.items()})
    return buf.getvalue().encode('utf-8')


# Each entry produces one CSV inside the zip. Each function returns
# (filename, fieldnames, iterable-of-dicts). Wrapped in try/except in the
# main task so a broken section doesn't poison the whole export.

def _members(marina):
    from apps.members.models import Member
    fields = [
        'id', 'name', 'email', 'phone', 'member_type', 'insurance_status',
        'docs_status', 'joined_at', 'preferred_name', 'nationality',
        'address', 'address_country', 'is_archived',
    ]
    qs = Member.objects.filter(marina=marina).values(*fields)
    return 'members.csv', fields, list(qs)


def _vessels(marina):
    from apps.vessels.models import Vessel
    fields = [
        'id', 'name', 'reg', 'owner_id', 'vessel_type',
        'loa', 'beam', 'draft', 'air_draft',
        'flag', 'mmsi', 'call_sign', 'year_built', 'builder', 'model',
        'created_at',
    ]
    qs = Vessel.objects.filter(marina=marina).values(*fields)
    return 'vessels.csv', fields, list(qs)


def _berths(marina):
    from apps.berths.models import Berth
    fields = [
        'id', 'code', 'pier_label', 'side', 'berth_type',
        'length_m', 'max_beam_m', 'max_draft_m',
        'status', 'berth_class', 'operational_type',
    ]
    qs = Berth.objects.filter(marina=marina).values(*fields)
    return 'berths.csv', fields, list(qs)


def _reservations(marina):
    from apps.reservations.models import Reservation
    fields = [
        'id', 'member_id', 'guest_name', 'guest_email', 'guest_phone',
        'status', 'paid', 'total_price', 'booking_source',
        'self_checked_in', 'self_checked_in_at', 'created_at',
    ]
    qs = Reservation.objects.filter(marina=marina).values(*fields)
    return 'reservations.csv', fields, list(qs)


def _invoices(marina):
    from apps.billing.models import Invoice
    fields = [
        'id', 'invoice_number', 'member_id', 'status',
        'subtotal', 'tax_total', 'total',
        'due_date', 'paid_at', 'billing_period', 'invoice_type',
        'reservation_id', 'created_at',
    ]
    qs = Invoice.objects.filter(marina=marina).values(*fields)
    return 'invoices.csv', fields, list(qs)


def _payments(marina):
    from apps.billing.models import Payment
    fields = ['id', 'invoice_id', 'amount', 'method', 'paid_at']
    qs = Payment.objects.filter(invoice__marina=marina).values(*fields)
    return 'payments.csv', fields, list(qs)


SECTIONS = [
    _members, _vessels, _berths, _reservations, _invoices, _payments,
]


def _build_zip(marina):
    """Build the export zip in memory. Returns (bytes, entity_counts, errors)."""
    counts = {}
    errors = []
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            'README.txt',
            (
                f'DocksBase data export for: {marina.name}\n'
                f'Generated: {datetime.now(tz=timezone.utc).isoformat()}\n\n'
                'Each CSV contains one row per record at the moment of export.\n'
                'IDs are stable across exports. Foreign-key columns end in _id.\n'
            ).encode('utf-8'),
        )
        for build in SECTIONS:
            try:
                filename, fields, rows = build(marina)
                zf.writestr(filename, _csv_bytes(rows, fields))
                counts[filename] = len(rows)
            except Exception as exc:
                logger.exception('Export section failed: %s', build.__name__)
                errors.append(f'{build.__name__}: {exc}')
        if errors:
            zf.writestr('errors.txt', '\n'.join(errors).encode('utf-8'))
    return buf.getvalue(), counts, errors


def _send_ready_email(export, signed_url):
    """Notify the requester their export is ready. Best-effort."""
    from django.core.mail import send_mail
    user = export.requested_by
    if not user or not user.email:
        return
    name = getattr(user, 'first_name', '') or user.email
    body = (
        f'Hi {name},\n\n'
        f'Your data export for {export.marina.name} is ready.\n\n'
        f'Download: {signed_url}\n\n'
        f'This link expires in {EXPORT_TTL_DAYS} days. You can also re-download\n'
        f'from Settings → Data while the export is still active.\n\n'
        f'— DocksBase'
    )
    try:
        send_mail(
            subject=f'Your DocksBase data export is ready',
            message=body,
            from_email=None,
            recipient_list=[user.email],
            fail_silently=True,
        )
    except Exception:
        logger.exception('Failed to send export-ready email for export %s', export.pk)


@shared_task(bind=True, name='apps.accounts.tasks.generate_data_export', max_retries=2)
def generate_data_export(self, export_id):
    from apps.accounts.models import DataExport
    try:
        export = DataExport.objects.select_related('marina', 'requested_by').get(pk=export_id)
    except DataExport.DoesNotExist:
        logger.warning('generate_data_export: DataExport %s not found', export_id)
        return

    export.status = DataExport.Status.RUNNING
    export.save(update_fields=['status'])

    try:
        data, counts, errors = _build_zip(export.marina)
        stamp = datetime.now(tz=timezone.utc).strftime('%Y%m%d-%H%M%S')
        path = f'exports/{export.marina_id}/{stamp}-export-{export.pk}.zip'
        default_storage.save(path, ContentFile(data))

        export.file_path     = path
        export.size_bytes    = len(data)
        export.entity_counts = counts
        export.error_message = '\n'.join(errors) if errors else ''
        export.status        = DataExport.Status.READY
        export.ready_at      = django_tz.now()
        export.expires_at    = django_tz.now() + timedelta(days=EXPORT_TTL_DAYS)
        export.save()

        # Build a signed URL for the email. We always re-sign on download
        # via the view, so this URL is only the convenience one.
        signed_url = ''
        try:
            signed_url = default_storage.url(path)
        except Exception:
            pass
        _send_ready_email(export, signed_url)
    except Exception as exc:
        logger.exception('Export %s failed', export_id)
        export.status = DataExport.Status.FAILED
        export.error_message = str(exc)[:2000]
        export.save(update_fields=['status', 'error_message'])
        raise

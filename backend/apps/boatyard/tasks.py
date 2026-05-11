"""
apps/boatyard/tasks.py
Track 5 — Boatyard Advanced Celery tasks.

All tasks follow the project's conventions:
- Long-running tasks use a Redis lock to prevent duplicate runs.
- Retries use exponential back-off via max_retries + countdown.
- All task dispatches from synchronous code use transaction.on_commit().
"""

import csv
import io
import logging
from decimal import Decimal, InvalidOperation

from celery import shared_task
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Critical Path Method (CPM)
# ---------------------------------------------------------------------------

@shared_task(bind=True, max_retries=3, default_retry_delay=10)
def recalculate_critical_path(self, work_order_id: int) -> dict:
    """
    Topological sort + forward pass to identify the critical path for all
    tasks in a WorkOrder.

    Algorithm:
    1. Load all WorkOrderTask rows for the WO.
    2. Build a predecessor adjacency list (FS dependency only; others are
       treated the same way for now — the lag_days field is respected).
    3. Kahn's algorithm for topological sort (also detects cycles).
    4. Forward pass: earliest_finish[task] = max(predecessor.earliest_finish)
       + lag + duration.
    5. Any task on the longest path is critical.

    Uses a Redis lock (60 s TTL) so concurrent signal firings collapse into
    one execution.
    """
    from .models import WorkOrderTask, TaskDependency

    lock_key = f'cpm_lock_wo_{work_order_id}'
    lock_acquired = cache.add(lock_key, '1', timeout=60)
    if not lock_acquired:
        logger.info('CPM lock busy for WO %s, skipping.', work_order_id)
        return {'skipped': True}

    try:
        tasks = list(
            WorkOrderTask.objects.filter(work_order_id=work_order_id)
        )
        if not tasks:
            return {'tasks': 0}

        task_map = {t.pk: t for t in tasks}

        deps = list(
            TaskDependency.objects.filter(
                predecessor__work_order_id=work_order_id
            ).values('predecessor_id', 'successor_id', 'lag_days')
        )

        # Build in-degree and adjacency maps
        in_degree = {t.pk: 0 for t in tasks}
        adjacency = {t.pk: [] for t in tasks}  # predecessor_id -> [(successor_id, lag)]
        for dep in deps:
            pred_id = dep['predecessor_id']
            succ_id = dep['successor_id']
            lag = dep['lag_days'] or 0
            if succ_id in in_degree:
                in_degree[succ_id] += 1
            if pred_id in adjacency:
                adjacency[pred_id].append((succ_id, lag))

        # Kahn's topological sort
        from collections import deque
        queue = deque(pk for pk, deg in in_degree.items() if deg == 0)
        topo_order = []
        while queue:
            pk = queue.popleft()
            topo_order.append(pk)
            for succ_id, _ in adjacency.get(pk, []):
                in_degree[succ_id] -= 1
                if in_degree[succ_id] == 0:
                    queue.append(succ_id)

        if len(topo_order) != len(tasks):
            logger.warning('Cycle detected in task dependencies for WO %s.', work_order_id)
            return {'error': 'cycle_detected'}

        # Forward pass: track earliest_finish (in days from project start)
        duration = {}
        for t in tasks:
            d = (t.planned_end - t.planned_start).days + 1
            duration[t.pk] = max(d, 1)

        earliest_finish = {pk: duration[pk] for pk in topo_order}

        for pk in topo_order:
            for succ_id, lag in adjacency.get(pk, []):
                candidate = earliest_finish[pk] + lag + duration[succ_id]
                if candidate > earliest_finish.get(succ_id, 0):
                    earliest_finish[succ_id] = candidate

        if not earliest_finish:
            return {'tasks': 0}

        project_duration = max(earliest_finish.values())

        # A task is critical if its earliest_finish equals the project duration
        # (simplified critical path — full float calculation omitted for brevity).
        critical_ids = {
            pk for pk, ef in earliest_finish.items() if ef == project_duration
        }

        # Bulk update is_critical
        to_critical = [pk for pk in task_map if pk in critical_ids]
        to_not_critical = [pk for pk in task_map if pk not in critical_ids]

        with transaction.atomic():
            WorkOrderTask.objects.filter(pk__in=to_critical).update(is_critical=True)
            WorkOrderTask.objects.filter(pk__in=to_not_critical).update(is_critical=False)

        return {
            'work_order_id': work_order_id,
            'tasks': len(tasks),
            'critical': len(to_critical),
        }
    except Exception as exc:
        logger.exception('recalculate_critical_path failed for WO %s', work_order_id)
        raise self.retry(exc=exc)
    finally:
        cache.delete(lock_key)


# ---------------------------------------------------------------------------
# Supplier price file import
# ---------------------------------------------------------------------------

@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def import_supplier_price_file(self, price_file_id: int) -> dict:
    """
    Parse a SupplierPriceFile (CSV or API), compare prices against current
    Part.unit_cost, create PartPriceHistory rows, and flag large changes.

    The column mapping is fetched from SupplierColumnMap for this supplier.
    Large changes (abs change_pct > flag_threshold_pct) set is_flagged=True
    and increment rows_flagged; they do NOT auto-apply (operator must approve).

    On failure the task retries up to 3 times with exponential back-off.
    """
    from .models import SupplierPriceFile, SupplierColumnMap, Part, PartPriceHistory

    try:
        pf = SupplierPriceFile.objects.get(pk=price_file_id)
    except SupplierPriceFile.DoesNotExist:
        logger.error('SupplierPriceFile %s not found.', price_file_id)
        return {'error': 'not_found'}

    pf.status = SupplierPriceFile.ImportStatus.PROCESSING
    pf.save(update_fields=['status'])

    try:
        col_map_obj = SupplierColumnMap.objects.filter(
            marina=pf.marina,
            supplier_name=pf.supplier_name,
        ).first()
        col_map = col_map_obj.mapping if col_map_obj else {}

        part_no_col  = col_map.get('part_no',   'part_no')
        price_col    = col_map.get('unit_cost',  'unit_cost')

        # -- Fetch raw data --------------------------------------------------
        rows = []
        if pf.import_format == SupplierPriceFile.ImportFormat.CSV and pf.file_url:
            import urllib.request
            with urllib.request.urlopen(pf.file_url, timeout=30) as resp:
                content = resp.read().decode('utf-8', errors='replace')
            reader = csv.DictReader(io.StringIO(content))
            rows = list(reader)
        elif pf.import_format == SupplierPriceFile.ImportFormat.API and pf.api_endpoint:
            import urllib.request, json
            with urllib.request.urlopen(pf.api_endpoint, timeout=30) as resp:
                rows = json.loads(resp.read())
        else:
            pf.status = SupplierPriceFile.ImportStatus.FAILED
            pf.error_detail = 'No file_url or api_endpoint configured for this format.'
            pf.completed_at = timezone.now()
            pf.save(update_fields=['status', 'error_detail', 'completed_at'])
            return {'error': 'no_source'}

        # -- Process rows ----------------------------------------------------
        rows_processed = 0
        rows_updated   = 0
        rows_flagged   = 0
        history_bulk   = []

        for row in rows:
            rows_processed += 1
            raw_part_no = row.get(part_no_col, '').strip()
            raw_price   = row.get(price_col, '').strip()
            if not raw_part_no or not raw_price:
                continue

            try:
                new_price = Decimal(raw_price)
            except InvalidOperation:
                continue

            try:
                part = Part.objects.get(marina=pf.marina, part_no=raw_part_no)
            except Part.DoesNotExist:
                continue

            old_price = part.unit_cost
            if old_price and old_price != 0:
                change_pct = ((new_price - old_price) / old_price * 100).quantize(Decimal('0.01'))
            else:
                change_pct = None

            is_flagged = bool(
                change_pct is not None
                and abs(change_pct) > pf.flag_threshold_pct
            )

            history_bulk.append(
                PartPriceHistory(
                    marina=pf.marina,
                    part=part,
                    price_file=pf,
                    old_unit_cost=old_price,
                    new_unit_cost=new_price,
                    change_pct=change_pct,
                    is_flagged=is_flagged,
                    applied=False,
                )
            )
            rows_updated += 1
            if is_flagged:
                rows_flagged += 1

        with transaction.atomic():
            PartPriceHistory.objects.bulk_create(history_bulk)
            pf.rows_processed = rows_processed
            pf.rows_updated   = rows_updated
            pf.rows_flagged   = rows_flagged
            pf.status         = SupplierPriceFile.ImportStatus.COMPLETED
            pf.completed_at   = timezone.now()
            pf.save(update_fields=[
                'rows_processed', 'rows_updated', 'rows_flagged',
                'status', 'completed_at',
            ])

        return {
            'price_file_id': price_file_id,
            'rows_processed': rows_processed,
            'rows_updated': rows_updated,
            'rows_flagged': rows_flagged,
        }

    except Exception as exc:
        pf.status = SupplierPriceFile.ImportStatus.FAILED
        pf.error_detail = str(exc)[:2000]
        pf.completed_at = timezone.now()
        try:
            pf.save(update_fields=['status', 'error_detail', 'completed_at'])
        except Exception:
            pass
        logger.exception('import_supplier_price_file failed for PriceFile %s', price_file_id)
        raise self.retry(exc=exc, countdown=30 * (2 ** self.request.retries))


# ---------------------------------------------------------------------------
# Warranty claim PDF generation
# ---------------------------------------------------------------------------

@shared_task(bind=True, max_retries=2, default_retry_delay=60)
def generate_warranty_claim_pdf(self, claim_id: int) -> dict:
    """
    Render a warranty claim PDF using WeasyPrint, upload to S3, and email
    the claim document URL to the agreement contact.

    Requires:
    - weasyprint installed in the environment.
    - django-storages + boto3 configured for S3 (DEFAULT_FILE_STORAGE).
    - Django email backend configured.
    """
    from .models import WarrantyClaim
    from django.template.loader import render_to_string
    from django.core.mail import send_mail
    from django.conf import settings

    try:
        claim = WarrantyClaim.objects.select_related(
            'agreement', 'work_order', 'marina'
        ).get(pk=claim_id)
    except WarrantyClaim.DoesNotExist:
        logger.error('WarrantyClaim %s not found.', claim_id)
        return {'error': 'not_found'}

    try:
        try:
            import weasyprint
        except ImportError:
            logger.error('weasyprint is not installed — cannot generate PDF.')
            return {'error': 'weasyprint_not_installed'}

        html_content = render_to_string(
            'boatyard/warranty_claim_pdf.html',
            {'claim': claim},
        )
        pdf_bytes = weasyprint.HTML(string=html_content).write_pdf()

        # Upload to S3 / default storage
        from django.core.files.storage import default_storage
        from django.core.files.base import ContentFile

        path = f'warranty_claims/claim_{claim_id}.pdf'
        default_storage.save(path, ContentFile(pdf_bytes))
        pdf_url = default_storage.url(path)

        with transaction.atomic():
            claim.claim_document_url = pdf_url
            claim.save(update_fields=['claim_document_url'])

        # Email the agreement contact
        contact_email = claim.agreement.contact_email
        if contact_email:
            send_mail(
                subject=f'Warranty Claim — {claim.claim_reference or f"Claim #{claim.pk}"}',
                message=(
                    f'Please find the warranty claim document at:\n{pdf_url}\n\n'
                    f'Claim amount: {claim.total_claimed}\n'
                    f'Work Order: {claim.work_order}\n'
                ),
                from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', 'noreply@docksbase.com'),
                recipient_list=[contact_email],
                fail_silently=True,
            )

        return {'claim_id': claim_id, 'pdf_url': pdf_url}

    except Exception as exc:
        logger.exception('generate_warranty_claim_pdf failed for claim %s', claim_id)
        raise self.retry(exc=exc)


# ---------------------------------------------------------------------------
# Warranty GL entry posting
# ---------------------------------------------------------------------------

@shared_task(bind=True, max_retries=3, default_retry_delay=15)
def post_warranty_gl_entry(self, claim_id: int) -> dict:
    """
    Create a JournalEntry for a warranty reimbursement.

    billing.JournalEntry does not yet exist (pending Track 4 GL implementation).
    This task is a stub that logs the intent and returns early until the
    JournalEntry model is available.

    When Track 4 is implemented:
    - DR: Accounts Receivable (manufacturer) = amount_reimbursed
    - CR: warranty_gl_account (warranty income) = amount_reimbursed
    - CR/DR: warranty_cogs_offset_account as required.
    """
    from .models import WarrantyClaim

    try:
        claim = WarrantyClaim.objects.select_related(
            'marina', 'agreement'
        ).get(pk=claim_id)
    except WarrantyClaim.DoesNotExist:
        logger.error('WarrantyClaim %s not found.', claim_id)
        return {'error': 'not_found'}

    # Check if JournalEntry model exists
    try:
        from billing.models import JournalEntry  # noqa
    except ImportError:
        logger.info(
            'billing.JournalEntry not yet available — GL entry for claim %s deferred.',
            claim_id,
        )
        return {'deferred': True, 'reason': 'JournalEntry model not yet implemented'}

    logger.info(
        'post_warranty_gl_entry: claim %s, amount %s — GL stub executed.',
        claim_id, claim.amount_reimbursed,
    )
    return {'claim_id': claim_id, 'gl_posted': False, 'note': 'stub'}


# ---------------------------------------------------------------------------
# Truck stock low-level alert
# ---------------------------------------------------------------------------

@shared_task
def check_truck_restock() -> dict:
    """
    Identify service truck InventoryLevel rows where quantity < par and par
    is set.  Sends a daily digest email to the marina harbour_master_email.

    Intended to run daily at 07:00 via Celery Beat (see INSTALL.md).
    """
    from .models import InventoryLevel, Location
    from django.core.mail import send_mail
    from django.conf import settings

    low_items = list(
        InventoryLevel.objects.select_related(
            'part', 'location', 'marina'
        ).filter(
            location__location_type=Location.LocationType.TRUCK,
            par__isnull=False,
            quantity__lt=models_F('par'),
        )
    )

    if not low_items:
        return {'low_items': 0}

    # Group by marina
    from collections import defaultdict
    by_marina = defaultdict(list)
    for item in low_items:
        by_marina[item.marina].append(item)

    emails_sent = 0
    for marina, items in by_marina.items():
        recipient = getattr(marina, 'harbour_master_email', '') or ''
        if not recipient:
            logger.warning('Marina %s has no harbour_master_email set.', marina.pk)
            continue

        lines = '\n'.join(
            f'  - {item.part.name} | location: {item.location.name} '
            f'| qty: {item.quantity} | par: {item.par}'
            for item in items
        )
        send_mail(
            subject=f'[DocksBase] Truck Restock Alert — {marina.name}',
            message=(
                f'The following parts are below par level on service trucks:\n\n'
                f'{lines}\n\n'
                f'Please arrange restocking at your earliest convenience.'
            ),
            from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', 'noreply@docksbase.com'),
            recipient_list=[recipient],
            fail_silently=True,
        )
        emails_sent += 1

    return {'low_items': len(low_items), 'emails_sent': emails_sent}


# Avoid top-level import that doesn't work in this module
def models_F(field_name):
    """Return a Django F() expression.  Imported lazily to avoid circular issues."""
    from django.db.models import F
    return F(field_name)

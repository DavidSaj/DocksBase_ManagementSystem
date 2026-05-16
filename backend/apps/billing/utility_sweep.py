"""
apps/billing/utility_sweep.py

Sweep service for `apps.utilities.PendingUtilityCharge`.

Each `PendingUtilityCharge` is a staged utility charge (created via webhook
smart-meter readings or manual dockwalk readings). They sit in a staging
ledger with `swept_to_invoice = NULL` until this sweep attaches them to an
invoice line item.

For each marina (or a single marina if requested) the sweep:
  1. Locks all pending rows whose `swept_to_invoice IS NULL` and
     `created_at <= now` (we use `created_at` as the "charged_at" surrogate;
     the model has no separate field).
  2. Groups them by member.
  3. For each member, either appends to an existing draft `Invoice` for the
     current billing period or creates a new draft `Invoice` scoped to that
     period.
  4. Creates one `InvoiceLineItem` per pending row (tax rate mirrored from
     the utility `ChargeableItem` looked up by category/pricing_model), and
     sets `pending.swept_to_invoice` to the target invoice.

Idempotency: a row whose `swept_to_invoice` is non-null is skipped. Re-running
the sweep cannot double-add lines because the filter excludes already-swept
rows and `select_for_update()` serialises concurrent runs per row.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable

from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)


@dataclass
class SweepResult:
    invoices_created: int = 0
    invoices_appended: int = 0
    lines_added: int = 0
    rows_swept: int = 0
    rows_skipped: int = 0
    marinas: list = field(default_factory=list)

    def merge(self, other: "SweepResult") -> None:
        self.invoices_created += other.invoices_created
        self.invoices_appended += other.invoices_appended
        self.lines_added += other.lines_added
        self.rows_swept += other.rows_swept
        self.rows_skipped += other.rows_skipped
        self.marinas.extend(other.marinas)


def _current_billing_period(now=None) -> str:
    now = now or timezone.now()
    return now.strftime('%Y-%m')


def _lookup_utility_item(marina, is_electricity: bool):
    """
    Find the utility ChargeableItem used as the canonical tax/rate source for
    this charge type. Mirrors the lookup in
    `apps.utilities.views.DockwalkReadingView._stage_charge`.
    """
    from apps.billing.models import ChargeableItem

    pricing_model = 'per_kwh' if is_electricity else 'per_m3'
    return (
        ChargeableItem.objects
        .filter(marina=marina, category='utility',
                pricing_model=pricing_model, is_active=True)
        .select_related('tax_category')
        .first()
    )


def _resolve_tax_rate(marina, pending) -> tuple[Decimal, "object | None"]:
    """
    Return (tax_rate_percent, chargeable_item or None) for a pending row.
    """
    is_electricity = pending.kwh_delta is not None
    item = _lookup_utility_item(marina, is_electricity)
    if item is None:
        return Decimal('0.00'), None
    return Decimal(str(item.tax_category.rate)), item


def _line_description(pending) -> str:
    """
    Build a human-readable line item description that doubles as a back-ref
    to the originating `PendingUtilityCharge` row. The `InvoiceLineItem` model
    has no dedicated `source_ref` column, so we embed the pending PK in the
    text (also stable, queryable via icontains).
    """
    is_electricity = pending.kwh_delta is not None
    delta = pending.kwh_delta if is_electricity else pending.m3_delta
    unit = 'kWh' if is_electricity else 'm³'
    meter_label = getattr(pending.meter, 'label', '') or pending.meter.device_id
    return (
        f'Utility ({unit}) — {meter_label} — {delta} {unit} '
        f'[pending#{pending.pk}]'
    )


def _open_invoice_for(marina, member, period: str):
    """
    Return the marina/member draft invoice for the given billing period if
    one already exists, else None. Caller holds the lock.
    """
    from apps.billing.models import Invoice

    return (
        Invoice.objects
        .select_for_update()
        .filter(marina=marina, member=member, status='draft',
                billing_period=period)
        .order_by('id')
        .first()
    )


def _create_draft_invoice(marina, member, period: str):
    from apps.billing.service import create_invoice

    return create_invoice(
        marina=marina,
        member=member,
        source_type='utility_sweep',
        source_id=f'{period}',
        billing_period=period,
    )


def _add_line_for_pending(invoice, pending) -> None:
    from apps.billing.service import add_line_item

    marina = invoice.marina
    tax_rate, item = _resolve_tax_rate(marina, pending)
    quantity = pending.kwh_delta if pending.kwh_delta is not None else pending.m3_delta
    add_line_item(
        invoice=invoice,
        description=_line_description(pending),
        quantity=quantity if quantity is not None else Decimal('1'),
        unit_price=pending.unit_price,
        tax_rate=tax_rate,
        chargeable_item=item,
    )


def _sweep_marina(marina, *, now, dry_run: bool = False) -> SweepResult:
    """
    Sweep a single marina inside one transaction.
    Locks pending rows + target invoices with select_for_update().
    """
    from apps.utilities.models import PendingUtilityCharge
    from apps.billing.models import Invoice  # noqa: F401  (ensure import side-effects)

    result = SweepResult()
    period = _current_billing_period(now)

    with transaction.atomic():
        # Lock all eligible rows for this marina up front.
        pending_qs = (
            PendingUtilityCharge.objects
            .select_for_update(skip_locked=False)
            .select_related('member', 'meter')
            .filter(marina=marina,
                    swept_to_invoice__isnull=True,
                    created_at__lte=now)
            .order_by('id')
        )
        pending_rows = list(pending_qs)
        if not pending_rows:
            return result

        # Group by member.
        by_member: dict = defaultdict(list)
        for row in pending_rows:
            by_member[row.member_id].append(row)

        for member_id, rows in by_member.items():
            member = rows[0].member
            invoice = _open_invoice_for(marina, member, period)
            if invoice is None:
                if dry_run:
                    result.invoices_created += 1
                else:
                    invoice = _create_draft_invoice(marina, member, period)
                    result.invoices_created += 1
            else:
                result.invoices_appended += 1

            for pending in rows:
                if pending.swept_to_invoice_id is not None:
                    # Defensive: another transaction snuck in. Skip.
                    result.rows_skipped += 1
                    continue
                if dry_run:
                    result.lines_added += 1
                    result.rows_swept += 1
                    continue
                _add_line_for_pending(invoice, pending)
                pending.swept_to_invoice = invoice
                pending.save(update_fields=['swept_to_invoice'])
                result.lines_added += 1
                result.rows_swept += 1

        if dry_run:
            transaction.set_rollback(True)

    result.marinas.append(marina.id)
    return result


def sweep_pending_utility_charges(
    marina_ids: Iterable[int] | None = None,
    *,
    now=None,
    dry_run: bool = False,
) -> SweepResult:
    """
    Run the sweep across all marinas with eligible pending rows, or only the
    marinas in ``marina_ids`` if provided.

    Returns an aggregated `SweepResult`.
    """
    from apps.accounts.models import Marina
    from apps.utilities.models import PendingUtilityCharge

    now = now or timezone.now()

    eligible_marina_ids = (
        PendingUtilityCharge.objects
        .filter(swept_to_invoice__isnull=True, created_at__lte=now)
        .values_list('marina_id', flat=True)
        .distinct()
    )
    if marina_ids is not None:
        eligible_marina_ids = [
            mid for mid in eligible_marina_ids if mid in set(marina_ids)
        ]

    aggregate = SweepResult()
    for marina in Marina.objects.filter(id__in=list(eligible_marina_ids)):
        try:
            sub = _sweep_marina(marina, now=now, dry_run=dry_run)
            aggregate.merge(sub)
            logger.info(
                'utility-sweep: marina=%s swept=%d lines=%d new=%d appended=%d (dry_run=%s)',
                marina.id, sub.rows_swept, sub.lines_added,
                sub.invoices_created, sub.invoices_appended, dry_run,
            )
        except Exception:
            logger.exception('utility-sweep: failed for marina=%s', marina.id)
    return aggregate

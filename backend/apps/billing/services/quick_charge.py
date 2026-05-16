"""Quick-Add Charges service layer.

Implements the three "trap" guards from the spec:
    1. PI race-condition guard — 409 if the reservation's active invoice has a
       Stripe payment intent in ``pending``/``processing``/``requires_action``.
    2. Single open-draft rule — ``select_for_update`` on the reservation and
       reuse any existing un-finalised invoice; only create a new draft when
       exactly zero un-finalised invoices exist for the reservation.
    3. Global idempotency — keys are globally unique across the platform
       (``IdempotencyKey.key`` is ``unique=True``).  Source-scoped via
       ``source='quick_charge'``.

Public entry points:
    resolve_target_invoice(reservation)  -> Invoice
    add_charge(...)                      -> dict (response payload)
    undo(line_id, undo_token)            -> dict
"""
from __future__ import annotations

import secrets
from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP

from django.db import IntegrityError, transaction
from django.utils import timezone

from .. import service as billing_service
from ..models import (
    ChargeableItem,
    IdempotencyKey,
    Invoice,
    InvoiceLineItem,
)

UNDO_WINDOW_SECONDS = 30
PI_IN_FLIGHT_STATUSES = {'pending', 'processing', 'requires_action'}
UN_FINALISED_INVOICE_STATUSES = ('draft', 'unpaid', 'open')


class PaymentIntentInFlight(Exception):
    """Raised when the reservation's invoice has a Stripe PI in-flight."""


class QuickChargeError(Exception):
    """Generic 4xx-style error for the quick-charge flow."""

    def __init__(self, detail, code='quick_charge_error', http_status=400):
        super().__init__(detail)
        self.detail = detail
        self.code = code
        self.http_status = http_status


def _recompute_totals(invoice):
    items = list(invoice.items.all())
    subtotal = sum((i.total_price for i in items), Decimal('0.00'))
    tax_total = sum((i.line_tax for i in items), Decimal('0.00'))
    invoice.subtotal = subtotal.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    invoice.tax_total = tax_total.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    invoice.total = (subtotal + tax_total).quantize(
        Decimal('0.01'), rounding=ROUND_HALF_UP,
    )
    invoice.save(update_fields=['subtotal', 'tax_total', 'total'])


def resolve_target_invoice(reservation):
    """Resolve the invoice that a quick-charge line should land on.

    MUST be called inside ``transaction.atomic()``.  Locks the reservation row
    via ``select_for_update`` so concurrent quick-charges cannot both create a
    second draft (trap fix #2).
    """
    from apps.reservations.models import Reservation

    # Re-fetch with row lock — trap fix #2 (no split drafts).
    locked = (
        Reservation.objects.select_for_update().get(pk=reservation.pk)
    )

    # Trap fix #2: single open-draft rule.  Find any un-finalised invoice for
    # this reservation, ordered preferring draft → unpaid → open.
    existing = (
        Invoice.objects
        .select_for_update()
        .filter(reservation=locked, status__in=UN_FINALISED_INVOICE_STATUSES)
        .order_by('-id')
        .first()
    )

    if existing is not None:
        # Trap fix #1: PI race-condition guard.
        if existing.payment_intent_status in PI_IN_FLIGHT_STATUSES:
            raise PaymentIntentInFlight(existing)
        return existing

    # No un-finalised invoice — create a fresh draft attached to the
    # reservation.  Re-uses the existing numbering helper.
    invoice = billing_service.create_invoice(
        marina=locked.marina,
        member=locked.member,
        source_type='quick_charge',
        source_id=str(locked.pk),
    )
    invoice.reservation = locked
    invoice.save(update_fields=['reservation'])
    return invoice


def _build_response(line):
    return {
        'invoice_line_id': line.pk,
        'invoice_id': line.invoice_id,
        'invoice_status': line.invoice.status,
        'description': line.description,
        'qty': str(line.quantity),
        'unit_price': str(line.unit_price),
        'total_price': str(line.total_price),
        'tax_rate': str(line.tax_rate),
        'undo_token': line.undo_token,
        'undo_expires_at': (
            (line.created_at or timezone.now())
            + timedelta(seconds=UNDO_WINDOW_SECONDS)
        ).isoformat(),
    }


def add_charge(*, reservation, item, qty, idempotency_key,
               staff_member=None, notes=''):
    """Create the quick-charge line.  Idempotent on ``idempotency_key``.

    Returns ``(payload_dict, created_bool)``.
    """
    # ── Idempotency replay (trap fix #3 — global unique key) ─────────────
    existing_key = IdempotencyKey.objects.filter(key=str(idempotency_key)).first()
    if existing_key is not None:
        if existing_key.source != 'quick_charge':
            raise QuickChargeError(
                'Idempotency key already used for a different operation.',
                code='idempotency_conflict', http_status=409,
            )
        return existing_key.response_json, False

    # ── Validation ──────────────────────────────────────────────────────
    try:
        qty_dec = Decimal(str(qty))
    except Exception:
        raise QuickChargeError('Invalid quantity.', http_status=400)
    if qty_dec <= 0:
        raise QuickChargeError('Quantity must be > 0.', http_status=400)
    if not item.qty_variable and qty_dec != Decimal('1'):
        raise QuickChargeError(
            'This item does not support variable quantities.',
            code='qty_not_variable', http_status=400,
        )
    if not item.is_active:
        raise QuickChargeError('Item is inactive.', code='inactive', http_status=410)
    if item.marina_id != reservation.marina_id:
        raise QuickChargeError('Item not available for this marina.', http_status=404)

    with transaction.atomic():
        try:
            invoice = resolve_target_invoice(reservation)
        except PaymentIntentInFlight:
            raise QuickChargeError(
                'Checkout in progress. Cannot add charges.',
                code='checkout_in_progress', http_status=409,
            )

        unit_price = Decimal(str(item.unit_price))
        total_price = (qty_dec * unit_price).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP,
        )
        tax_rate = Decimal(str(item.tax_category.rate)) if item.tax_category_id else Decimal('0.00')
        description = item.name + (f' — {notes}' if notes else '')

        line = InvoiceLineItem.objects.create(
            invoice=invoice,
            description=description,
            quantity=qty_dec,
            unit_price=unit_price,
            total_price=total_price,
            tax_rate=tax_rate,
            chargeable_item=item,
            added_by=staff_member,
            source='quick_charge',
            notes=notes or '',
            undo_token=secrets.token_urlsafe(24),
        )
        _recompute_totals(invoice)

        response = _build_response(line)

        # ── Persist idempotency row (trap fix #3) ───────────────────────
        try:
            IdempotencyKey.objects.create(
                key=str(idempotency_key),
                source='quick_charge',
                response_json=response,
            )
        except IntegrityError:
            # A concurrent request beat us to it — replay its response.
            existing_key = IdempotencyKey.objects.get(key=str(idempotency_key))
            # Roll back our line, return the cached payload.
            transaction.set_rollback(True)
            return existing_key.response_json, False

    return response, True


def undo(*, line_id, undo_token, staff_member=None):
    """Hard-delete a quick-charge line within the 30-second window.

    Validates the supplied ``undo_token`` (not just the id) to prevent another
    staff member from spoofing the undo URL.
    """
    try:
        line = (
            InvoiceLineItem.objects
            .select_related('invoice')
            .get(pk=line_id)
        )
    except InvoiceLineItem.DoesNotExist:
        raise QuickChargeError('Line not found.', http_status=404)

    if line.source != 'quick_charge':
        raise QuickChargeError('Line is not a quick charge.', http_status=400)
    if not line.undo_token or line.undo_token != str(undo_token):
        raise QuickChargeError(
            'Invalid undo token.', code='invalid_token', http_status=403,
        )

    created = line.created_at or timezone.now()
    elapsed = (timezone.now() - created).total_seconds()
    if elapsed > UNDO_WINDOW_SECONDS:
        raise QuickChargeError(
            'Undo window expired — ask a manager to void.',
            code='undo_window_expired', http_status=410,
        )

    if line.invoice.status != 'draft':
        raise QuickChargeError(
            'Cannot undo on a finalised invoice — ask a manager to void.',
            code='invoice_finalised', http_status=400,
        )

    invoice = line.invoice
    with transaction.atomic():
        line.delete()
        _recompute_totals(invoice)

    return {'detail': 'ok'}

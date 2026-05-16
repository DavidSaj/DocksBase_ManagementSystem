"""API endpoints for the Quick-Add Charges feature.

Routes (mounted at ``/api/v1/quick-charge/`` — see :mod:`apps.billing.urls`):

    GET  /items/          — per-marina catalog where ``show_in_quick_charge``.
    GET  /active-boats/   — checked-in reservations sorted by berth code.
    POST /                — add a charge.
    POST /<line_id>/undo/ — undo within 30 s using the issued token.
"""
from __future__ import annotations

from rest_framework import status as http_status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.reservations.models import Reservation

from .models import ChargeableItem, InvoiceLineItem
from .services import quick_charge as qc_service


# ── Helpers ──────────────────────────────────────────────────────────────────


def _staff_member(request):
    return getattr(request.user, 'staff_profile', None)


def _serialize_item(item):
    return {
        'id': item.id,
        'name': item.name,
        'category': item.category,
        'unit_price': str(item.unit_price),
        'tax_rate_pct': str(item.tax_category.rate) if item.tax_category_id else '0.00',
        'qty_variable': item.qty_variable,
        'show_in_quick_charge': item.show_in_quick_charge,
    }


def _berth_code_for(reservation):
    """Return the canonical berth code for a reservation.

    Reservations carry berths via ``ReservationItem.berth`` (multi-item
    bookings are possible — pick the first item's berth deterministically by
    ``check_in, id``).
    """
    item = (
        reservation.items
        .select_related('berth', 'berth__pier', 'vessel')
        .order_by('check_in', 'id')
        .first()
    )
    if not item or not item.berth_id:
        return ('', '', None, item)
    berth = item.berth
    pier_code = berth.pier.code if berth.pier_id else ''
    return (berth.code, pier_code, berth.id, item)


# ── Endpoints ────────────────────────────────────────────────────────────────


class QuickChargeItemsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        marina = request.user.marina
        if marina is None:
            return Response([], status=http_status.HTTP_200_OK)
        items = (
            ChargeableItem.objects
            .select_related('tax_category')
            .filter(
                marina=marina,
                show_in_quick_charge=True,
                is_active=True,
            )
            .order_by('category', 'name')
        )
        return Response([_serialize_item(i) for i in items])


class QuickChargeActiveBoatsView(APIView):
    """Reservations currently on dock, sorted by berth code."""

    permission_classes = [IsAuthenticated]

    ACTIVE_STATUSES = ('checked_in', 'overstay', 'pending_checkout')

    def get(self, request):
        marina = request.user.marina
        if marina is None:
            return Response([])
        reservations = (
            Reservation.objects
            .filter(marina=marina, status__in=self.ACTIVE_STATUSES)
            .prefetch_related('items__berth__pier', 'items__vessel')
            .select_related('member')
        )
        rows = []
        for r in reservations:
            berth_code, pier_code, _, item = _berth_code_for(r)
            vessel_name = ''
            if item:
                vessel_name = (
                    item.vessel.name if item.vessel_id else item.vessel_name
                ) or ''
            member_name = ''
            if r.member_id:
                member_name = r.member.name
            elif r.guest_name:
                member_name = r.guest_name
            rows.append({
                'reservation_id': r.pk,
                'boat_name': vessel_name,
                'member_name': member_name,
                'berth_code': berth_code,
                'pier': pier_code,
                'status': r.status,
            })
        # Sort by berth code (natural-ish: split letters + numeric).
        def _key(row):
            code = row['berth_code'] or ''
            # Split into (alpha-prefix, numeric, suffix) for B-1 < B-2 < B-10.
            import re
            m = re.match(r'^([A-Za-z\-]*)(\d+)?(.*)$', code)
            if not m:
                return (code, 0, '')
            return (m.group(1) or '', int(m.group(2)) if m.group(2) else 0, m.group(3) or '')
        rows.sort(key=_key)
        return Response(rows[:200])


class QuickChargeCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        data = request.data or {}
        reservation_id = data.get('reservation_id')
        item_id = data.get('item_id')
        qty = data.get('qty', 1)
        notes = (data.get('notes') or '')[:255]
        idempotency_key = data.get('idempotency_key') or request.headers.get(
            'Idempotency-Key'
        )

        if not reservation_id or not item_id or not idempotency_key:
            return Response(
                {'detail': 'reservation_id, item_id and idempotency_key are required.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        marina = request.user.marina
        try:
            reservation = Reservation.objects.get(pk=reservation_id, marina=marina)
        except Reservation.DoesNotExist:
            return Response(
                {'detail': 'Reservation not found.'},
                status=http_status.HTTP_404_NOT_FOUND,
            )
        try:
            item = ChargeableItem.objects.select_related('tax_category').get(
                pk=item_id, marina=marina,
            )
        except ChargeableItem.DoesNotExist:
            return Response(
                {'detail': 'Item not found.'},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        try:
            payload, created = qc_service.add_charge(
                reservation=reservation,
                item=item,
                qty=qty,
                idempotency_key=idempotency_key,
                staff_member=_staff_member(request),
                notes=notes,
            )
        except qc_service.QuickChargeError as exc:
            return Response(
                {'detail': exc.detail, 'code': exc.code},
                status=exc.http_status,
            )

        status_code = (
            http_status.HTTP_201_CREATED if created else http_status.HTTP_200_OK
        )
        return Response(payload, status=status_code)


class QuickChargeUndoView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, line_id):
        token = (request.data or {}).get('undo_token')
        if not token:
            return Response(
                {'detail': 'undo_token is required.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        # Marina-scope the line to prevent cross-marina probing.
        marina = request.user.marina
        if not InvoiceLineItem.objects.filter(
            pk=line_id, invoice__marina=marina,
        ).exists():
            return Response(
                {'detail': 'Line not found.'},
                status=http_status.HTTP_404_NOT_FOUND,
            )
        try:
            result = qc_service.undo(
                line_id=line_id,
                undo_token=token,
                staff_member=_staff_member(request),
            )
        except qc_service.QuickChargeError as exc:
            return Response(
                {'detail': exc.detail, 'code': exc.code},
                status=exc.http_status,
            )
        return Response(result, status=http_status.HTTP_200_OK)

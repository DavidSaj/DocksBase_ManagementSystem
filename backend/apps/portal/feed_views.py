# backend/apps/portal/feed_views.py
import datetime
import logging

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.billing.models import Invoice
from apps.members.models import Member
from apps.vessels.models import Vessel
from .boater_auth import BoaterTokenAuthentication
from .boater_context import resolve_portal_member
from .member_auth import PortalMemberAuthentication

_log = logging.getLogger(__name__)


def _build_items(member):
    """Return a list of ActionableItem dicts, unsorted."""
    today = datetime.date.today()
    items = []

    # --- Overdue / open invoices ---
    invoices = Invoice.objects.filter(
        member=member,
        marina=member.marina,
        status__in=['unpaid', 'open'],
    ).order_by('due_date')

    for inv in invoices:
        is_overdue = inv.due_date and inv.due_date < today
        items.append({
            'type':     'invoice_overdue' if is_overdue else 'invoice_open',
            'priority': 10 if is_overdue else 15,
            'id':       inv.id,
            'label':    f'Invoice #{inv.invoice_number or inv.id}',
            'amount':   str(inv.total),
            'due_date': str(inv.due_date) if inv.due_date else None,
            'overdue':  is_overdue,
        })

    # --- Vessel status (always shown if vessel on file) ---
    # Vessel.owner is the FK to Member; Vessel also has a marina FK
    vessel = Vessel.objects.filter(owner=member, marina=member.marina).first()
    if vessel:
        items.append({
            'type':     'vessel_status',
            'priority': 20,
            'id':       vessel.id,
            'label':    vessel.name or 'Your vessel',
            'loa':      str(vessel.loa) if vessel.loa else None,
            'beam':     str(vessel.beam) if vessel.beam else None,
        })

    # --- Insurance alert ---
    # Member.insurance_status choices: 'valid', 'due_soon', 'expired', 'missing'
    if member.insurance_status in ('due_soon', 'expired', 'missing'):
        items.append({
            'type':     'insurance_alert',
            'priority': 10 if member.insurance_status in ('expired', 'missing') else 15,
            'label':    'Insurance',
            'status':   member.insurance_status,
        })

    return items


class FeedView(APIView):
    authentication_classes = [BoaterTokenAuthentication, PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        member = resolve_portal_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=404)

        items = _build_items(member)
        items.sort(key=lambda x: x['priority'])
        return Response(items)

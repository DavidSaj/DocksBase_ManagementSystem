"""Cross-marina trips endpoint for the boater portal dashboard.

Returns all bookings and reservations for the authenticated boater across
every marina they have records at — used by `portal.docksbase.com/dashboard`
when the user opens the PWA without a marina-scoped magic link.
"""
import datetime as _dt

from django.db.models import Min, Max
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.reservations.models import Booking, Reservation
from .checkin_auth import PortalTokenAuthentication
from .member_auth import PortalMemberAuthentication


def _resolve_email(user):
    return (
        getattr(user, 'email', None)
        or getattr(user, 'boater_email', None)
        or ''
    ).strip().lower()


def _marina_payload(marina):
    return {
        'slug': marina.slug,
        'name': marina.name,
    }


class MyTripsView(APIView):
    """GET /api/portal/my-trips/

    Accepts either guest `Bearer` or member `MemberBearer` tokens. Returns
    bookings + reservations for the boater's email across all marinas. Upcoming
    trips first (sorted by check_in asc), then past trips (sorted by check_in
    desc).
    """
    authentication_classes = [PortalTokenAuthentication, PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        email = _resolve_email(request.user)
        if not email:
            return Response({'detail': 'Authenticated email not available.'}, status=401)

        today = _dt.date.today()

        bookings = (
            Booking.objects
            .filter(guest_email__iexact=email)
            .exclude(status__in=['cancelled', 'abandoned'])
            .select_related('marina')
            .order_by('check_in')
        )

        reservations = (
            Reservation.objects
            .filter(guest_email__iexact=email)
            .exclude(status__in=['cancelled', 'abandoned'])
            .select_related('marina')
            .annotate(item_in=Min('items__check_in'), item_out=Max('items__check_out'))
            .order_by('item_in')
        )

        trips = []

        for b in bookings:
            check_in = b.check_in
            check_out = b.check_out
            trips.append({
                'type': 'booking',
                'id': b.pk,
                'ref': f'BK-{b.pk}',
                'marina': _marina_payload(b.marina),
                'check_in': check_in.isoformat() if check_in else None,
                'check_out': check_out.isoformat() if check_out else None,
                'status': b.status,
                'upcoming': bool(check_out and check_out >= today),
                'deep_link': f'/{b.marina.slug}/booking/{b.pk}/confirmed',
            })

        for r in reservations:
            check_in = r.item_in
            check_out = r.item_out
            if not check_in:
                continue
            trips.append({
                'type': 'reservation',
                'id': r.pk,
                'ref': f'RES-{r.pk}',
                'marina': _marina_payload(r.marina),
                'check_in': check_in.isoformat(),
                'check_out': check_out.isoformat() if check_out else None,
                'status': r.status,
                'upcoming': bool(check_out and check_out >= today),
                'deep_link': f'/{r.marina.slug}/booking/{r.pk}/confirmed',
            })

        upcoming = sorted(
            (t for t in trips if t['upcoming']),
            key=lambda t: t['check_in'],
        )
        past = sorted(
            (t for t in trips if not t['upcoming']),
            key=lambda t: t['check_in'],
            reverse=True,
        )

        return Response({
            'email': email,
            'trips': upcoming + past,
            'counts': {
                'upcoming': len(upcoming),
                'past': len(past),
            },
        })

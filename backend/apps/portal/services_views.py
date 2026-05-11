# backend/apps/portal/services_views.py
import datetime as dt
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status as http_status
from rest_framework.permissions import IsAuthenticated

from apps.members.models import Member
from apps.reservations.models import Booking

from .member_auth import PortalMemberAuthentication
from .models import CraneRequest


def _get_member(request):
    """Return Member for the authenticated PortalMemberUser, scoped to marina."""
    return (
        Member.objects
        .filter(id=request.user.member_id, marina__slug=request.user.marina_slug)
        .select_related('marina')
        .first()
    )


class PortalMemberCraneRequestView(APIView):
    authentication_classes = [PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    VALID_SERVICE_TYPES = {'launch', 'haul_out', 'both'}

    def post(self, request):
        member = _get_member(request)
        if member is None:
            return Response(
                {'detail': 'Member not found.'},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        service_type = request.data.get('service_type', '')

        if service_type not in self.VALID_SERVICE_TYPES:
            return Response(
                {'detail': 'Invalid service_type.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        try:
            requested_date = dt.date.fromisoformat(
                str(request.data.get('requested_date') or '')
            )
        except ValueError:
            return Response(
                {'detail': 'requested_date must be a valid ISO date (YYYY-MM-DD).'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        raw_notes = request.data.get('notes')
        notes = raw_notes.strip() if isinstance(raw_notes, str) else ''

        crane_req = CraneRequest.objects.create(
            member=member,
            service_type=service_type,
            requested_date=requested_date,
            notes=notes,
        )
        return Response(
            {'id': crane_req.id, 'status': crane_req.status},
            status=http_status.HTTP_201_CREATED,
        )


class PortalMemberBookingView(APIView):
    authentication_classes = [PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        booking = (
            Booking.objects
            .filter(
                vessel__owner=member,
                marina=member.marina,
                status__in=['checked_in', 'pending', 'confirmed'],
            )
            .select_related('berth')
            .order_by('-check_in')
            .first()
        )
        if booking is None:
            return Response({'detail': 'No active booking found.'}, status=http_status.HTTP_404_NOT_FOUND)

        return Response({
            'id':         booking.id,
            'berth_id':   booking.berth_id,
            'berth_name': booking.berth.code if booking.berth else '',
            'check_in':   str(booking.check_in),
            'check_out':  str(booking.check_out),
        })


class PortalMemberExtendStayView(APIView):
    authentication_classes = [PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    def _active_booking(self, member):
        return (
            Booking.objects
            .filter(
                vessel__owner=member,
                marina=member.marina,
                status__in=['checked_in', 'pending', 'confirmed'],
            )
            .select_related('berth', 'vessel')
            .order_by('-check_in')
            .first()
        )

    def _has_conflict(self, booking, new_check_out):
        return Booking.objects.filter(
            berth=booking.berth,
            status__in=['pending', 'confirmed', 'checked_in'],
            check_in__lt=new_check_out,
            check_out__gt=booking.check_out,
        ).exclude(id=booking.id).exists()

    def get(self, request):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        booking = self._active_booking(member)
        if booking is None:
            return Response({'detail': 'No active booking found.'}, status=http_status.HTTP_404_NOT_FOUND)
        if booking.berth is None:
            return Response({'detail': 'No berth assigned.'}, status=http_status.HTTP_400_BAD_REQUEST)

        new_check_out = request.query_params.get('new_check_out', '')
        if not new_check_out:
            return Response({'detail': 'new_check_out is required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        try:
            dt.date.fromisoformat(new_check_out)
        except ValueError:
            return Response({'detail': 'new_check_out must be a valid ISO date (YYYY-MM-DD).'}, status=http_status.HTTP_400_BAD_REQUEST)

        return Response({'available': not self._has_conflict(booking, new_check_out)})

    def post(self, request):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        booking = self._active_booking(member)
        if booking is None:
            return Response({'detail': 'No active booking found.'}, status=http_status.HTTP_404_NOT_FOUND)
        if booking.berth is None:
            return Response({'detail': 'No berth assigned.'}, status=http_status.HTTP_400_BAD_REQUEST)

        new_check_out = request.data.get('new_check_out', '')
        if not new_check_out:
            return Response({'detail': 'new_check_out is required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        try:
            check_out_date = dt.date.fromisoformat(new_check_out)
        except ValueError:
            return Response({'detail': 'Invalid date format.'}, status=http_status.HTTP_400_BAD_REQUEST)

        if check_out_date <= booking.check_out:
            return Response(
                {'detail': 'New check-out must be after the current check-out.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        if self._has_conflict(booking, check_out_date):
            return Response(
                {'detail': 'Berth not available for these dates.'},
                status=http_status.HTTP_409_CONFLICT,
            )

        nights = (check_out_date - booking.check_out).days
        new_booking = Booking.objects.create(
            marina=member.marina,
            berth=booking.berth,
            vessel=booking.vessel,
            check_in=booking.check_out,
            check_out=new_check_out,
            nights=nights,
            status='pending',
            booking_source='portal_member',
        )
        return Response({'id': new_booking.id}, status=http_status.HTTP_201_CREATED)

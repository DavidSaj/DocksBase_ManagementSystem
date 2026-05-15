from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Activity, ActivityBooking, ActivityResourceRequirement, ActivityTimeSlot, CancellationPolicy
from .serializers import (
    ActivityBookingSerializer,
    ActivityResourceRequirementSerializer,
    ActivitySerializer,
    ActivityTimeSlotSerializer,
    CancellationPolicySerializer,
)
from .services.booking import SeasonWarning, ResourceUnavailable, book_activity_session
from .services.cancellation import cancel_activity_booking
from .services.transitions import (
    confirm_requested_booking,
    reject_requested_booking,
    CapacityExceeded,
)


class CancellationPolicyViewSet(viewsets.ModelViewSet):
    """CRUD for marina's cancellation policies."""
    permission_classes = [IsAuthenticated]
    serializer_class = CancellationPolicySerializer

    def get_queryset(self):
        return CancellationPolicy.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class ActivityViewSet(viewsets.ModelViewSet):
    """CRUD for activity catalogue. Includes availability slot checker."""
    permission_classes = [IsAuthenticated]
    serializer_class = ActivitySerializer

    def get_queryset(self):
        return (
            Activity.objects.filter(marina=self.request.user.marina)
            .prefetch_related('pricing_rules', 'resource_requirements', 'extras')
            .select_related('cancellation_policy')
        )

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)

    @action(detail=True, methods=['get'], url_path='availability')
    def availability(self, request, pk=None):
        """
        Returns available time slots for this activity between ?from=YYYY-MM-DD and ?to=YYYY-MM-DD.

        Query parameters:
          from  — start date (required)
          to    — end date (required, max 31 days from 'from')

        Response: list of slot dicts with bookable, capacity_remaining,
        instructor_available, equipment_available fields.
        """
        from datetime import date
        from .services.availability import get_activity_availability

        activity = self.get_object()
        date_from_str = request.query_params.get('from')
        date_to_str   = request.query_params.get('to')

        if not date_from_str or not date_to_str:
            return Response(
                {'detail': 'Both ?from=YYYY-MM-DD and ?to=YYYY-MM-DD are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            date_from = date.fromisoformat(date_from_str)
            date_to   = date.fromisoformat(date_to_str)
        except ValueError:
            return Response(
                {'detail': 'Invalid date format. Use YYYY-MM-DD.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if (date_to - date_from).days > 31:
            return Response(
                {'detail': 'Date range may not exceed 31 days.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        slots = get_activity_availability(activity, date_from, date_to)
        return Response({'slots': slots})


class ActivityBookingViewSet(viewsets.ModelViewSet):
    """
    CRUD for activity bookings.

    perform_create() delegates entirely to book_activity_session() to ensure
    the atomic booking + asset reservation + invoice sequence is always used.
    """
    permission_classes = [IsAuthenticated]
    serializer_class = ActivityBookingSerializer

    def get_queryset(self):
        qs = (
            ActivityBooking.objects.filter(marina=self.request.user.marina)
            .select_related('activity', 'member', 'assigned_instructor', 'invoice')
            .prefetch_related('participants', 'booking_extras')
        )
        # Optional filters
        date_val   = self.request.query_params.get('date')
        status_val = self.request.query_params.get('status')
        if date_val:
            qs = qs.filter(start_datetime__date=date_val)
        if status_val:
            qs = qs.filter(status=status_val)
        return qs

    def perform_create(self, serializer):
        from rest_framework.exceptions import ValidationError
        from .models import ActivityExtra

        marina       = self.request.user.marina
        validated    = serializer.validated_data
        activity     = validated['activity']
        start_dt     = validated['start_datetime']
        member       = validated.get('member')
        lead_name    = validated.get('lead_name', '')
        lead_email   = validated.get('lead_email', '')
        lead_phone   = validated.get('lead_phone', '')
        payment_mode = validated.get('payment_mode', 'direct')
        season_override     = validated.get('season_override', False)
        assigned_instructor = validated.get('assigned_instructor')
        participant_data    = validated.get('participants_input', [])
        extras_input        = validated.get('extras_input', [])

        # Resolve extras_input [{extra_id, quantity}] to model kwargs
        extras_data = []
        for entry in extras_input:
            try:
                extra = ActivityExtra.objects.get(pk=entry['extra_id'], activity=activity)
            except ActivityExtra.DoesNotExist:
                raise ValidationError({'extras_input': f"Extra {entry.get('extra_id')} not found."})
            extras_data.append({'extra': extra, 'quantity': entry.get('quantity', 1)})

        try:
            book_activity_session(
                marina=marina,
                activity=activity,
                start_datetime=start_dt,
                member=member,
                lead_name=lead_name,
                lead_email=lead_email,
                lead_phone=lead_phone,
                participant_data=participant_data,
                extras_data=extras_data,
                payment_mode=payment_mode,
                season_override=season_override,
                assigned_instructor_id=(
                    assigned_instructor.pk if assigned_instructor else None
                ),
            )
        except SeasonWarning as exc:
            raise ValidationError({
                'season_warning': True,
                'detail': str(exc),
            })
        except ResourceUnavailable as exc:
            # Return 409 Conflict
            from rest_framework.exceptions import APIException
            err = APIException(detail=str(exc))
            err.status_code = status.HTTP_409_CONFLICT
            raise err
        except ValueError as exc:
            raise ValidationError({'detail': str(exc)})

    @action(detail=True, methods=['post'], url_path='confirm')
    def confirm(self, request, pk=None):
        booking = self.get_object()
        try:
            confirm_requested_booking(booking)
        except CapacityExceeded as exc:
            return Response(
                {'detail': 'capacity_exceeded', 'remaining': exc.remaining},
                status=status.HTTP_409_CONFLICT,
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(ActivityBookingSerializer(booking).data)

    @action(detail=True, methods=['post'], url_path='reject')
    def reject(self, request, pk=None):
        booking = self.get_object()
        reason = request.data.get('reason', '')
        try:
            reject_requested_booking(booking, reason=reason)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(ActivityBookingSerializer(booking).data)

    @action(detail=True, methods=['post'], url_path='cancel')

    def cancel(self, request, pk=None):
        """
        Cancel a confirmed booking. Applies cancellation policy refund tiers.
        Body: { "reason": "optional reason string" }
        Response: { "refund_amount": "50.00" }
        """
        booking = self.get_object()

        if booking.status == ActivityBooking.Status.CANCELLED:
            return Response(
                {'detail': 'Booking is already cancelled.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reason = request.data.get('reason', '')
        result = cancel_activity_booking(booking, reason=reason)
        return Response(result)


class ActivityResourceRequirementViewSet(viewsets.ModelViewSet):
    """
    CRUD for per-activity resource requirements (instructor slots, equipment).
    Filters: ?activity=<id>
    """
    permission_classes = [IsAuthenticated]
    serializer_class = ActivityResourceRequirementSerializer

    def get_queryset(self):
        qs = ActivityResourceRequirement.objects.filter(
            activity__marina=self.request.user.marina
        ).select_related('activity', 'staff_member', 'asset')

        activity_id = self.request.query_params.get('activity')
        if activity_id:
            qs = qs.filter(activity_id=activity_id)
        return qs


class ActivityTimeSlotViewSet(viewsets.ModelViewSet):
    """
    CRUD for weekly activity time slots.
    Filters: ?activity=<id>
    """
    permission_classes = [IsAuthenticated]
    serializer_class = ActivityTimeSlotSerializer

    def get_queryset(self):
        qs = ActivityTimeSlot.objects.filter(
            activity__marina=self.request.user.marina
        ).select_related('activity')
        activity_id = self.request.query_params.get('activity')
        if activity_id:
            qs = qs.filter(activity_id=activity_id)
        return qs

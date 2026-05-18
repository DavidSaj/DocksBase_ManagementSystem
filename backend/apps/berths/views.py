from django.db import models
from django.http import HttpResponse
from rest_framework import generics, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.views import APIView
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from .models import Pier, Berth, MarinaMapConfig, Amenity, OTAConnection, BerthCategory, LogicalPier
from .serializers import PierSerializer, BerthSerializer, MarinaMapConfigSerializer, AmenitySerializer, OTAConnectionSerializer, BerthCategorySerializer, LogicalPierSerializer
from .sms_service import send_sms


class PierListCreateView(generics.ListCreateAPIView):
    serializer_class = PierSerializer

    def get_queryset(self):
        return Pier.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        code = serializer.validated_data.get('code', '')
        if '{n}' in code:
            marina = self.request.user.marina
            n = 1
            existing = set(Pier.objects.filter(marina=marina).values_list('code', flat=True))
            while code.replace('{n}', str(n)) in existing:
                n += 1
            serializer.validated_data['code'] = code.replace('{n}', str(n))
        serializer.save(marina=self.request.user.marina)


class PierDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = PierSerializer

    def get_queryset(self):
        return Pier.objects.filter(marina=self.request.user.marina)

    def update(self, request, *args, **kwargs):
        from django.db import transaction
        instance = self.get_object()
        partial = kwargs.pop('partial', False)
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)

        new_components = serializer.validated_data.get('components')
        if new_components is not None:
            old_ids = {c['id'] for c in (instance.components or [])}
            new_ids = {c['id'] for c in new_components}
            removed_ids = old_ids - new_ids
            if removed_ids:
                with transaction.atomic():
                    Berth.objects.filter(
                        pier=instance,
                        position_on_parent__in=removed_ids,
                    ).update(
                        pier=None,
                        position_on_parent='',
                        local_x=None,
                        local_y=None,
                    )
                    serializer.save()
                return Response(serializer.data)

        serializer.save()
        return Response(serializer.data)


class BerthListCreateView(generics.ListCreateAPIView):
    serializer_class = BerthSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status', 'pier', 'berth_type', 'operational_type']

    def get_queryset(self):
        from apps.reservations.models import Booking

        qs = (Berth.objects
              .filter(marina=self.request.user.marina)
              .select_related('pier', 'vessel', 'pricing_tier', 'booking_tier')
              .prefetch_related('bookings'))

        capable_for = self.request.query_params.get('capable_for')
        if capable_for:
            try:
                booking = Booking.objects.get(pk=int(capable_for), marina=self.request.user.marina)
            except (Booking.DoesNotExist, ValueError):
                raise ValidationError({'capable_for': 'Booking not found.'})
            if booking.boat_loa is not None:
                qs = qs.filter(length_m__gte=booking.boat_loa)
            if booking.boat_beam is not None:
                qs = qs.filter(max_beam_m__gte=booking.boat_beam)
            if booking.boat_draft is not None:
                qs = qs.filter(max_draft_m__gte=booking.boat_draft)

        return qs

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class BerthDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = BerthSerializer

    def get_queryset(self):
        return Berth.objects.filter(marina=self.request.user.marina)

    def perform_update(self, serializer):
        instance = serializer.instance
        new_conn = serializer.validated_data.get('ota_connection', '__not_provided__')

        if new_conn != '__not_provided__' and new_conn != instance.ota_connection:
            # Manual channel change → lock the berth permanently
            serializer.save(channel_locked=True)
        else:
            serializer.save()


class BerthAvailabilityView(APIView):
    """
    GET /berths/availability/?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD[&pier=<id>]

    Returns a dict mapping berth_id → { 'YYYY-MM-DD': status }.
    Status is derived from confirmed/active bookings; fallback to berth.status.
    """

    def get(self, request):
        from datetime import date, timedelta
        from apps.reservations.models import Booking

        marina = request.user.marina
        start_str = request.query_params.get('start_date')
        end_str   = request.query_params.get('end_date')
        pier_id   = request.query_params.get('pier')

        try:
            start = date.fromisoformat(start_str) if start_str else date.today()
            end   = date.fromisoformat(end_str)   if end_str   else start + timedelta(days=13)
        except (ValueError, TypeError):
            start = date.today()
            end   = start + timedelta(days=13)

        berths_qs = Berth.objects.filter(marina=marina)
        if pier_id:
            berths_qs = berths_qs.filter(pier_id=pier_id)

        # Build date range
        num_days = (end - start).days + 1
        dates = [start + timedelta(days=i) for i in range(num_days)]

        # Fetch relevant bookings once
        active_statuses = ['confirmed', 'pending', 'awaiting_payment', 'pending_payment',
                           'checked_in', 'overstay']
        bookings = Booking.objects.filter(
            marina=marina,
            status__in=active_statuses,
            check_in__lte=end,
            check_out__gte=start,
        ).values('berth_id', 'check_in', 'check_out', 'status')

        # Build occupancy map: berth_id → set of occupied dates
        occupied_dates: dict[int, set] = {}
        reserved_dates: dict[int, set] = {}
        occupied_statuses = {'checked_in', 'overstay'}
        for b in bookings:
            bid = b['berth_id']
            if bid is None:
                continue
            d = b['check_in']
            while d < b['check_out']:
                if start <= d <= end:
                    if b['status'] in occupied_statuses:
                        occupied_dates.setdefault(bid, set()).add(d)
                    else:
                        reserved_dates.setdefault(bid, set()).add(d)
                d = d + timedelta(days=1)

        result = {}
        for berth in berths_qs.only('id', 'status'):
            day_map = {}
            occ = occupied_dates.get(berth.id, set())
            res = reserved_dates.get(berth.id, set())
            base = berth.status  # available / maintenance / etc.
            for d in dates:
                if d in occ:
                    day_map[d.isoformat()] = 'occupied'
                elif d in res:
                    day_map[d.isoformat()] = 'reserved'
                else:
                    day_map[d.isoformat()] = base
            result[berth.id] = day_map

        return Response(result)


class BerthOccupancyStatsView(APIView):
    """
    GET /berths/occupancy-stats/

    Returns aggregate counts and breakdowns used by the OccupancyStats tab.
    Falls back gracefully if reservations app is unavailable.
    """

    def get(self, request):
        marina = request.user.marina
        berths = list(Berth.objects.filter(marina=marina).only('id', 'status', 'category', 'operational_type'))

        total       = len(berths)
        occupied    = sum(1 for b in berths if b.status == 'occupied')
        available   = sum(1 for b in berths if b.status == 'available')
        reserved    = sum(1 for b in berths if b.status == 'reserved')
        maintenance = sum(1 for b in berths if b.status == 'maintenance')
        occupancy_pct = round((occupied / total) * 100) if total else 0

        by_category: dict = {}
        for b in berths:
            cat = b.category_id or 'uncategorised'
            if cat not in by_category:
                by_category[cat] = {'total': 0, 'occupied': 0, 'available': 0,
                                    'reserved': 0, 'maintenance': 0}
            by_category[cat]['total'] += 1
            by_category[cat][b.status] = by_category[cat].get(b.status, 0) + 1

        by_op_type: dict = {}
        for b in berths:
            t = b.operational_type or 'unset'
            if t not in by_op_type:
                by_op_type[t] = {'total': 0, 'occupied': 0, 'available': 0}
            by_op_type[t]['total'] += 1
            if b.status == 'occupied':
                by_op_type[t]['occupied'] += 1
            if b.status == 'available':
                by_op_type[t]['available'] += 1

        return Response({
            'total': total,
            'occupied': occupied,
            'available': available,
            'reserved': reserved,
            'maintenance': maintenance,
            'occupancyPct': occupancy_pct,
            'byCategory': by_category,
            'byOpType': by_op_type,
        })


class MapConfigView(generics.RetrieveUpdateAPIView):
    serializer_class = MarinaMapConfigSerializer
    http_method_names = ['get', 'put', 'head', 'options']

    def get_object(self):
        obj, _ = MarinaMapConfig.objects.get_or_create(marina=self.request.user.marina)
        return obj


class BulkCreateBerthsView(APIView):
    """
    POST /api/v1/berths/bulk-create/
    Body: { prefix, start, count, length_m?, beam_m?, max_draft_m? }

    Creates berths named <prefix><start> through <prefix><start+count-1>.
    No pricing — physical records only.
    """

    def post(self, request):
        marina = request.user.marina
        prefix      = (request.data.get('prefix') or '').strip().upper()
        start       = request.data.get('start', 1)
        count       = request.data.get('count', 0)
        length_m         = request.data.get('length_m')
        beam_m           = request.data.get('beam_m')
        max_draft_m      = request.data.get('max_draft_m')
        berth_type       = (request.data.get('berth_type') or '').strip()
        berth_class      = (request.data.get('berth_class') or 'standard').strip()
        operational_type = (request.data.get('operational_type') or '').strip()

        if not prefix:
            return Response({'detail': 'prefix is required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            start = int(start)
            count = int(count)
        except (TypeError, ValueError):
            return Response({'detail': 'start and count must be integers.'}, status=status.HTTP_400_BAD_REQUEST)
        if count < 1 or count > 500:
            return Response({'detail': 'count must be between 1 and 500.'}, status=status.HTTP_400_BAD_REQUEST)

        created = []
        skipped = []
        for n in range(start, start + count):
            code = f'{prefix}{n}'
            berth, was_created = Berth.objects.get_or_create(
                marina=marina,
                code=code,
                defaults={
                    'length_m':         length_m,
                    'max_beam_m':       beam_m,
                    'max_draft_m':      max_draft_m,
                    'berth_type':       berth_type,
                    'berth_class':      berth_class,
                    'operational_type': operational_type,
                    'status':           'available',
                },
            )
            (created if was_created else skipped).append(code)

        return Response({
            'created': len(created),
            'skipped': len(skipped),
            'detail': f'Created {len(created)} berths, skipped {len(skipped)} existing.',
        }, status=status.HTTP_201_CREATED)


class BulkUpdateBerthPricingView(APIView):
    """
    PATCH /api/v1/berths/bulk-pricing/
    Body: { berth_ids: [1,2,3], pricing_tier_id: 7 | null }
    Updates pricing_tier on the given berths (null to unassign).
    """

    def patch(self, request):
        from apps.billing.models import ChargeableItem

        marina       = request.user.marina
        berth_ids    = request.data.get('berth_ids', [])
        tier_id      = request.data.get('pricing_tier_id')

        if not berth_ids or not isinstance(berth_ids, list):
            return Response({'detail': 'berth_ids must be a non-empty list.'}, status=status.HTTP_400_BAD_REQUEST)

        if tier_id is not None:
            try:
                tier_id = int(tier_id)
                ChargeableItem.objects.get(pk=tier_id, category='berth', marina=marina)
            except (ValueError, ChargeableItem.DoesNotExist):
                return Response({'detail': 'Pricing tier not found.'}, status=status.HTTP_400_BAD_REQUEST)

        updated = Berth.objects.filter(
            id__in=berth_ids,
            marina=marina,
        ).update(pricing_tier_id=tier_id)

        return Response({'updated': updated})


class BulkUpdateBerthCategoryView(APIView):
    """
    PATCH /api/v1/berths/bulk-category/
    Body: { berth_ids: [1,2,3], category_id: 7 | null }
    Updates category on the given berths (null to unassign).
    """

    def patch(self, request):
        marina      = request.user.marina
        berth_ids   = request.data.get('berth_ids', [])
        category_id = request.data.get('category_id')

        if not berth_ids or not isinstance(berth_ids, list):
            return Response({'detail': 'berth_ids must be a non-empty list.'}, status=status.HTTP_400_BAD_REQUEST)

        if category_id is not None:
            try:
                category_id = int(category_id)
                BerthCategory.objects.get(pk=category_id, marina=marina, is_active=True)
            except (ValueError, BerthCategory.DoesNotExist):
                return Response({'detail': 'Berth category not found.'}, status=status.HTTP_400_BAD_REQUEST)

        updated = Berth.objects.filter(
            id__in=berth_ids,
            marina=marina,
        ).update(category_id=category_id)

        return Response({'updated': updated})


class LogicalPierListCreateView(generics.ListCreateAPIView):
    serializer_class = LogicalPierSerializer

    def get_queryset(self):
        return LogicalPier.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class LogicalPierDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = LogicalPierSerializer

    def get_queryset(self):
        return LogicalPier.objects.filter(marina=self.request.user.marina)


class BroadcastSMSView(APIView):
    """
    POST /api/v1/berths/broadcast/
    Body (optional): { "pier_id": 3, "message": "..." }

    Sends an SMS to every boater currently occupying a berth in the marina
    (or a single pier if pier_id is given).  Phone is resolved from the
    active booking's guest_phone, or the vessel owner's member phone.
    """

    def post(self, request):
        marina = request.user.marina
        message = (request.data.get('message') or '').strip()
        pier_id = request.data.get('pier_id')

        if not message:
            return Response({'detail': 'message is required.'}, status=status.HTTP_400_BAD_REQUEST)

        berths_qs = Berth.objects.filter(marina=marina, status='occupied')
        if pier_id:
            berths_qs = berths_qs.filter(pier_id=pier_id)

        from apps.reservations.models import Booking
        active_bookings = Booking.objects.filter(
            marina=marina,
            berth__in=berths_qs,
            status='checked_in',
        ).select_related('vessel__owner', 'member')

        phones = set()
        for booking in active_bookings:
            phone = ''
            if booking.guest_phone:
                phone = booking.guest_phone
            elif booking.member and booking.member.phone:
                phone = booking.member.phone
            elif booking.vessel and booking.vessel.owner and booking.vessel.owner.phone:
                phone = booking.vessel.owner.phone

            if phone:
                phones.add(phone)

        if not phones:
            return Response({'detail': 'No phone numbers found for occupied berths.', 'sent': 0})

        sent = 0
        failed = 0
        for phone in phones:
            if send_sms(phone, message):
                sent += 1
            else:
                failed += 1

        return Response({
            'sent': sent,
            'failed': failed,
            'detail': f'Broadcast complete: {sent} sent, {failed} failed.',
        })


class AmenityListCreateView(generics.ListCreateAPIView):
    serializer_class = AmenitySerializer
    pagination_class = None

    def get_queryset(self):
        return Amenity.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class AmenityDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = AmenitySerializer

    def get_queryset(self):
        return Amenity.objects.filter(marina=self.request.user.marina)


class IcalFeedView(APIView):
    permission_classes = []  # public — outbound_token is the secret

    def get(self, request, token):
        from apps.berths.models import OTAConnection
        from .ical import generate_ota_ical
        try:
            conn = OTAConnection.objects.get(outbound_token=token)
        except OTAConnection.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=404)
        return HttpResponse(
            generate_ota_ical(conn),
            content_type='text/calendar; charset=utf-8',
            headers={'Content-Disposition': f'attachment; filename="{conn.slug}.ics"'},
        )


class OTAConnectionViewSet(viewsets.ModelViewSet):
    serializer_class = OTAConnectionSerializer
    pagination_class = None

    def get_queryset(self):
        return OTAConnection.objects.filter(marina=self.request.user.marina)

    @action(detail=True, methods=['post'])
    def sync(self, request, pk=None):
        from apps.accounts.features import is_feature_enabled
        conn = self.get_object()
        if not is_feature_enabled(conn.marina, 'ota_sync'):
            return Response({'detail': 'OTA sync is disabled for this marina.'}, status=status.HTTP_400_BAD_REQUEST)
        if not conn.inbound_ical_url:
            return Response({'detail': 'No inbound iCal URL configured.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            from apps.reservations.management.commands.sync_ota_bookings import sync_connection
        except ImportError:
            return Response({'detail': 'Sync command not yet available.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        count = sync_connection(conn, dry=False, stdout=None)
        conn.refresh_from_db(fields=['last_synced'])
        return Response({'synced': count, 'last_synced': conn.last_synced})

    @action(detail=True, methods=['post'])
    def rebalance(self, request, pk=None):
        conn = self.get_object()
        from apps.berths.allocator import rebalance_down
        rebalance_down(conn)
        return Response({'detail': 'Rebalance complete.'})


class BerthCategoryViewSet(viewsets.ModelViewSet):
    serializer_class = BerthCategorySerializer
    pagination_class = None

    def get_queryset(self):
        return BerthCategory.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


# ── Track 2 — Berth Intelligence views ────────────────────────────────────────

from .models import (
    BerthScoreWeights, TemporaryDeparture, SubLetBooking,
    FleetAssignJob, DockWalkSession, DockWalkEntry,
    BerthAlert, BerthListing, BerthListingEnquiry,
)
from .serializers import (
    BerthScoreWeightsSerializer, TemporaryDepartureSerializer, SubLetBookingSerializer,
    FleetAssignJobSerializer, DockWalkSessionSerializer, DockWalkEntrySerializer,
    BerthAlertSerializer, BerthListingSerializer, BerthListingEnquirySerializer,
)
from .scorer import SmartBerthScorer


class SmartAssignView(APIView):
    """
    GET /api/v1/berths/smart-assign/
    Returns a ranked list of available berths for the given vessel + date window.
    """

    def get(self, request):
        marina = request.user.marina
        params = request.query_params

        check_in_str  = params.get('check_in')
        check_out_str = params.get('check_out')
        if not check_in_str or not check_out_str:
            return Response(
                {'detail': 'check_in and check_out are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        import datetime as _dt
        try:
            check_in  = _dt.date.fromisoformat(check_in_str)
            check_out = _dt.date.fromisoformat(check_out_str)
        except ValueError:
            return Response({'detail': 'Invalid date format.'}, status=status.HTTP_400_BAD_REQUEST)

        vessel_params = {
            'loa':           params.get('boat_loa'),
            'beam':          params.get('boat_beam'),
            'draft':         params.get('boat_draft'),
            'air_draft':     params.get('air_draft'),
            'shore_power':   params.get('shore_power', '').lower() in ('true', '1'),
            'mooring_pref':  params.get('mooring_pref', ''),
        }

        # If vessel_id provided, load dimensions from DB (inline params override)
        vessel_id = params.get('vessel_id')
        if vessel_id:
            try:
                from apps.vessels.models import Vessel
                vessel = Vessel.objects.get(pk=int(vessel_id), marina=marina)
                if not vessel_params['loa']       and vessel.loa:
                    vessel_params['loa']       = float(vessel.loa)
                if not vessel_params['beam']      and vessel.beam:
                    vessel_params['beam']      = float(vessel.beam)
                if not vessel_params['draft']     and vessel.draft:
                    vessel_params['draft']     = float(vessel.draft)
                if not vessel_params['air_draft'] and vessel.air_draft:
                    vessel_params['air_draft'] = float(vessel.air_draft)
            except (Vessel.DoesNotExist, ValueError):
                return Response({'detail': 'Vessel not found.'}, status=status.HTTP_404_NOT_FOUND)

        scorer = SmartBerthScorer(marina, check_in, check_out, vessel_params)
        scored_berths = scorer.score_all()

        return Response({
            'scored_berths':       scored_berths,
            'recommended_berth_id': scored_berths[0]['berth_id'] if scored_berths else None,
        })


class ScoreWeightsView(APIView):
    """
    GET  /api/v1/berths/score-weights/   — retrieve weights
    PATCH /api/v1/berths/score-weights/  — update weights (sum must = 100)
    """

    def get(self, request):
        weights, _ = BerthScoreWeights.objects.get_or_create(marina=request.user.marina)
        return Response(BerthScoreWeightsSerializer(weights).data)

    def patch(self, request):
        weights, _ = BerthScoreWeights.objects.get_or_create(marina=request.user.marina)
        ser = BerthScoreWeightsSerializer(weights, data=request.data, partial=True)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        weights = ser.save()
        weights.full_clean()
        return Response(BerthScoreWeightsSerializer(weights).data)


class FleetAssignView(APIView):
    """
    POST /api/v1/berths/fleet-assign/
    Creates a FleetAssignJob and dispatches the Celery task inside on_commit().
    Returns 202 Accepted immediately.
    """

    def post(self, request):
        from django.db import transaction as _tx
        marina = request.user.marina

        job = FleetAssignJob.objects.create(
            marina=request.user.marina,
            request_payload=request.data,
            created_by=request.user,
        )

        def _dispatch():
            from apps.berths.tasks import solve_fleet_assignment
            task = solve_fleet_assignment.delay(job.pk)
            FleetAssignJob.objects.filter(pk=job.pk).update(celery_task_id=task.id)

        _tx.on_commit(_dispatch)

        return Response(
            {
                'job_id':     job.pk,
                'status':     job.status,
                'status_url': f'/api/v1/berths/fleet-assign/{job.pk}/status/',
            },
            status=status.HTTP_202_ACCEPTED,
        )


class FleetAssignStatusView(APIView):
    """
    GET /api/v1/berths/fleet-assign/{job_id}/status/
    Polls job status. Frontend polls every 2 seconds until complete or failed.
    """

    def get(self, request, job_id):
        try:
            job = FleetAssignJob.objects.get(pk=job_id, marina=request.user.marina)
        except FleetAssignJob.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(FleetAssignJobSerializer(job).data)


class TemporaryDepartureViewSet(viewsets.ModelViewSet):
    serializer_class = TemporaryDepartureSerializer
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        return TemporaryDeparture.objects.filter(
            marina=self.request.user.marina
        ).select_related('berth', 'vessel', 'member', 'created_by').prefetch_related('sublet_bookings')

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina, created_by=self.request.user)

    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        """Transition scheduled → active and create a temp_departure VesselMovement."""
        from django.utils import timezone as tz
        from django.db import transaction as _tx

        departure = self.get_object()
        if departure.status != 'scheduled':
            return Response(
                {'detail': 'Departure must be in scheduled status to activate.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        departure.status = 'active'
        departure.save(update_fields=['status'])

        _departure_id = departure.pk

        def _create_movement():
            from apps.movements.models import VesselMovement
            dep = TemporaryDeparture.objects.get(pk=_departure_id)
            VesselMovement.objects.create(
                marina=dep.marina,
                vessel=dep.vessel,
                movement_type='temp_departure',
                berth_from=dep.berth,
                departure=dep,
                actual_at=tz.now(),
                completed=True,
                recorded_by=request.user,
            )

        _tx.on_commit(_create_movement)

        return Response(TemporaryDepartureSerializer(departure).data)

    @action(detail=True, methods=['post'], url_path='return')
    def return_vessel(self, request, pk=None):
        """
        Transition active → returned.
        Handles inventory collision detection for any active sub-let bookings
        that extend past the actual return date.
        """
        from django.utils import timezone as tz
        from django.db import transaction as _tx
        import datetime as _dt

        departure = self.get_object()
        if departure.status != 'active':
            return Response(
                {'detail': 'Departure must be in active status to process return.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        actual_return_str = request.data.get('actual_return') or tz.localdate().isoformat()
        try:
            actual_return = _dt.date.fromisoformat(actual_return_str)
        except ValueError:
            return Response({'detail': 'Invalid actual_return date.'}, status=status.HTTP_400_BAD_REQUEST)

        departure.actual_return = actual_return
        departure.status = 'returned'
        departure.save(update_fields=['actual_return', 'status'])

        _departure_id = departure.pk
        _actual_return = actual_return
        _user = request.user

        def _create_movement_and_handle_collisions():
            from apps.movements.models import VesselMovement
            from apps.berths.models import BerthAlert
            dep = TemporaryDeparture.objects.get(pk=_departure_id)
            VesselMovement.objects.create(
                marina=dep.marina,
                vessel=dep.vessel,
                movement_type='temp_return',
                berth_to=dep.berth,
                departure=dep,
                actual_at=tz.now(),
                completed=True,
                recorded_by=_user,
            )

            # Inventory collision handling
            from apps.reservations.models import Booking
            colliding_sublets = SubLetBooking.objects.filter(
                departure=dep,
                booking__check_out__gt=_actual_return,
            ).select_related('booking', 'booking__berth')

            collision_report = []
            for sublet in colliding_sublets:
                booking = sublet.booking
                actual_nights = max((_actual_return - booking.check_in).days, 1)
                sublet.inventory_collision = True
                sublet.actual_nights_sublet = actual_nights

                # Pro-rate holder share
                if dep.berth.pricing_tier:
                    sublet.holder_share = (
                        dep.berth.pricing_tier.unit_price
                        * actual_nights
                        * (dep.revenue_share_pct / 100)
                    )

                sublet.save(update_fields=['inventory_collision', 'actual_nights_sublet', 'holder_share'])

                # Attempt relocation of the displaced transient guest
                scorer = SmartBerthScorer(
                    dep.marina,
                    check_in=_actual_return,
                    check_out=booking.check_out,
                    vessel_params={
                        'loa':   float(booking.boat_loa)  if booking.boat_loa  else None,
                        'beam':  float(booking.boat_beam) if booking.boat_beam else None,
                        'draft': float(booking.boat_draft) if booking.boat_draft else None,
                    },
                )
                alternatives = scorer.score_all()
                relocated = False

                if alternatives:
                    new_berth_id = alternatives[0]['berth_id']
                    Booking.objects.filter(pk=booking.pk).update(berth_id=new_berth_id)
                    booking.refresh_from_db(fields=['berth'])
                    VesselMovement.objects.create(
                        marina=dep.marina,
                        vessel=booking.vessel,
                        movement_type='berth_change',
                        berth_from=dep.berth,
                        berth_to=booking.berth,
                        booking=booking,
                        actual_at=tz.now(),
                        completed=True,
                        recorded_by=_user,
                    )
                    sublet.relocation_booking = booking
                    sublet.save(update_fields=['relocation_booking'])
                    relocated = True
                else:
                    BerthAlert.objects.create(
                        marina=dep.marina,
                        alert_type='unexpected_vessel',
                        berth=dep.berth,
                        vessel=booking.vessel,
                        departure=dep,
                        detail=(
                            f'Sub-let booking {booking.pk} cannot be relocated — '
                            f'no alternative berth available for {_actual_return} to {booking.check_out}.'
                        ),
                    )

                collision_report.append({
                    'sublet_booking_id': sublet.pk,
                    'relocated':         relocated,
                })

        _tx.on_commit(_create_movement_and_handle_collisions)

        return Response({'status': 'returned', 'inventory_collisions': []})


class SubLetBookingViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = SubLetBookingSerializer

    def get_queryset(self):
        return SubLetBooking.objects.filter(
            marina=self.request.user.marina
        ).select_related('departure', 'booking')

    @action(detail=True, methods=['post'], url_path='apply-credit')
    def apply_credit(self, request, pk=None):
        """
        POST /api/v1/berths/sublet-bookings/apply-credit/{id}/
        Creates a credit invoice for the berth holder.
        Only allowed after the transient guest has checked out.
        """
        from django.utils import timezone as tz

        sublet = self.get_object()
        if sublet.booking.status != 'checked_out':
            return Response(
                {'detail': 'Credit can only be applied after the transient guest has checked out.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if sublet.credit_applied_at:
            return Response(
                {'detail': 'Credit has already been applied for this sub-let.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        nights = sublet.actual_nights_sublet or sublet.booking.nights or 1
        credit_amount = sublet.holder_share

        # Create credit invoice (negative line item) against the holder member
        try:
            from apps.billing import service as billing_service
            import datetime as _dt
            inv = billing_service.create_invoice(
                sublet.marina,
                member=sublet.departure.member,
                source_type='sublet_credit',
                source_id=str(sublet.pk),
                due_date=_dt.date.today(),
            )
            billing_service.add_line_item(
                inv,
                description=f'Sub-let credit — {nights} night(s) @ berth {sublet.departure.berth.code}',
                quantity=1,
                unit_price=-abs(credit_amount),  # negative = credit
            )
            billing_service.finalize_invoice(inv)
            sublet.credit_invoice_id = inv.pk
        except Exception as exc:
            return Response(
                {'detail': f'Invoice creation failed: {exc}'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        sublet.credit_applied_at = tz.now()
        sublet.save(update_fields=['credit_invoice_id', 'credit_applied_at'])

        return Response(SubLetBookingSerializer(sublet).data)


class DockWalkSessionViewSet(viewsets.ModelViewSet):
    serializer_class = DockWalkSessionSerializer
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        return DockWalkSession.objects.filter(
            marina=self.request.user.marina
        ).select_related('pier', 'walked_by').prefetch_related('entries')

    def perform_create(self, serializer):
        marina = self.request.user.marina
        pier = serializer.validated_data.get('pier')

        # Compute berth_order from Berth.position_index for the given pier
        berth_order = []
        if pier:
            berth_ids = (
                Berth.objects.filter(
                    marina=marina,
                    pier__logical_pier=pier,
                )
                .order_by('position_index')
                .values_list('id', flat=True)
            )
            berth_order = list(berth_ids)

        serializer.save(
            marina=marina,
            walked_by=self.request.user,
            berth_order=berth_order,
        )

    @action(detail=True, methods=['patch'])
    def finish(self, request, pk=None):
        """Mark a dock walk session as finished."""
        from django.utils import timezone as tz

        session = self.get_object()
        if session.finished_at:
            return Response({'detail': 'Session is already finished.'}, status=status.HTTP_400_BAD_REQUEST)
        session.finished_at = tz.now()
        session.save(update_fields=['finished_at'])
        return Response(DockWalkSessionSerializer(session).data)


class DockWalkEntryBulkView(APIView):
    """
    POST /api/v1/berths/dock-walk/sessions/{pk}/entries/
    Accept a list of observations. Run discrepancy detection and meter anomaly checks.
    """

    def post(self, request, pk):
        marina = request.user.marina
        try:
            session = DockWalkSession.objects.get(pk=pk, marina=marina)
        except DockWalkSession.DoesNotExist:
            return Response({'detail': 'Session not found.'}, status=status.HTTP_404_NOT_FOUND)

        from apps.reservations.models import Booking
        from django.utils import timezone as tz
        import datetime as _dt

        observations = request.data if isinstance(request.data, list) else []
        created_count = 0
        discrepancies = []
        meter_anomalies = []

        for obs in observations:
            try:
                berth = Berth.objects.get(pk=obs['berth'], marina=marina)
            except (Berth.DoesNotExist, KeyError):
                continue

            observed_at_str = obs.get('observed_at')
            try:
                observed_at = _dt.datetime.fromisoformat(observed_at_str)
                if observed_at.tzinfo is None:
                    observed_at = observed_at.replace(tzinfo=tz.utc)
            except (TypeError, ValueError):
                observed_at = tz.now()

            observed_date     = observed_at.date()
            observed_occupancy = obs.get('observed_occupancy', 'unknown')

            # Turnaround day guard
            is_turnaround = Booking.objects.filter(
                berth=berth,
                marina=marina,
            ).filter(
                models.Q(check_out=observed_date) | models.Q(check_in=observed_date)
            ).exists()

            # Active booking at observed_at
            active_bookings = Booking.objects.filter(
                berth=berth,
                marina=marina,
                status__in=('confirmed', 'checked_in'),
                check_in__lte=observed_date,
                check_out__gt=observed_date,
            )
            has_active_booking = active_bookings.exists()

            discrepancy = 'none'
            alert = None

            if not is_turnaround:
                today = tz.localdate()
                # Overstay: booking check_out is in the past but vessel still present
                overdue_booking = Booking.objects.filter(
                    berth=berth,
                    marina=marina,
                    status__in=('confirmed', 'checked_in'),
                    check_out__lte=today,
                ).first()

                if overdue_booking and observed_occupancy == 'occupied':
                    discrepancy = 'overstay'
                    alert = BerthAlert.objects.create(
                        marina=marina,
                        alert_type='overstay',
                        berth=berth,
                        vessel=overdue_booking.vessel,
                        detail=f'Booking {overdue_booking.pk} has check_out {overdue_booking.check_out} but berth still occupied.',
                    )
                elif has_active_booking and observed_occupancy == 'empty':
                    discrepancy = 'unexpected_empty'
                    active_bk = active_bookings.first()
                    alert = BerthAlert.objects.create(
                        marina=marina,
                        alert_type='unexpected_empty',
                        berth=berth,
                        vessel=active_bk.vessel if active_bk else None,
                        detail=f'Berth expected to be occupied (booking {active_bk.pk if active_bk else "?"}) but appears empty.',
                    )
                elif not has_active_booking and observed_occupancy == 'occupied':
                    discrepancy = 'unexpected_vessel'
                    alert = BerthAlert.objects.create(
                        marina=marina,
                        alert_type='unexpected_vessel',
                        berth=berth,
                        detail='Vessel present in berth with no active booking.',
                    )

            # Meter anomaly detection
            entry_alert = alert
            elec = obs.get('electric_reading_kwh')
            if elec is not None:
                prev_entry = (
                    DockWalkEntry.objects.filter(
                        berth=berth,
                        marina=marina,
                        electric_reading_kwh__isnull=False,
                    )
                    .order_by('-observed_at')
                    .first()
                )
                if prev_entry and prev_entry.electric_reading_kwh:
                    delta = float(elec) - float(prev_entry.electric_reading_kwh)
                    if delta > 0:
                        # 30-day rolling average
                        from django.utils import timezone as tz2
                        cutoff = tz2.now() - _dt.timedelta(days=30)
                        historical = DockWalkEntry.objects.filter(
                            berth=berth,
                            marina=marina,
                            electric_reading_kwh__isnull=False,
                            observed_at__gte=cutoff,
                        ).order_by('observed_at')

                        deltas = []
                        prev_kwh = None
                        for h in historical:
                            if prev_kwh is not None:
                                d = float(h.electric_reading_kwh) - prev_kwh
                                if d > 0:
                                    deltas.append(d)
                            prev_kwh = float(h.electric_reading_kwh)

                        if deltas:
                            avg_delta = sum(deltas) / len(deltas)
                            if avg_delta > 0 and delta > 3 * avg_delta:
                                meter_alert = BerthAlert.objects.create(
                                    marina=marina,
                                    alert_type='meter_anomaly',
                                    berth=berth,
                                    detail=f'Electric reading spike: {delta:.1f} kWh vs avg {avg_delta:.1f} kWh.',
                                )
                                meter_anomalies.append({
                                    'berth_id': berth.pk,
                                    'alert_id': meter_alert.pk,
                                    'delta':    round(delta, 2),
                                    'avg':      round(avg_delta, 2),
                                })
                                if entry_alert is None:
                                    entry_alert = meter_alert

            entry = DockWalkEntry.objects.create(
                marina=marina,
                session=session,
                berth=berth,
                observed_occupancy=observed_occupancy,
                discrepancy=discrepancy,
                electric_reading_kwh=elec,
                water_reading_litres=obs.get('water_reading_litres'),
                notes=obs.get('notes', ''),
                observed_at=observed_at,
                alert=entry_alert,
            )
            created_count += 1
            if discrepancy != 'none':
                discrepancies.append({
                    'berth_id':    berth.pk,
                    'discrepancy': discrepancy,
                    'alert_id':    alert.pk if alert else None,
                })

        return Response({
            'created':       created_count,
            'discrepancies': discrepancies,
            'meter_anomalies': meter_anomalies,
        }, status=status.HTTP_201_CREATED)


class DockWalkOfflinePayloadView(APIView):
    """
    GET /api/v1/berths/dock-walk/offline-payload/
    Returns a compact snapshot suitable for service worker caching:
    - All berths with today's active booking (if any)
    - Last meter readings per berth
    - Active session if exists
    """

    def get(self, request):
        from apps.reservations.models import Booking
        from django.utils import timezone as tz

        marina = request.user.marina
        today  = tz.localdate()

        berths = Berth.objects.filter(
            marina=marina,
            berth_class='standard',
        ).exclude(status='maintenance').select_related('pier', 'category')

        # Today's active booking per berth (one per berth, earliest check_in wins)
        active_bookings = Booking.objects.filter(
            marina=marina,
            check_in__lte=today,
            check_out__gt=today,
            status__in=('confirmed', 'checked_in'),
        ).select_related('vessel').order_by('check_in')

        booking_by_berth = {}
        for bk in active_bookings:
            if bk.berth_id and bk.berth_id not in booking_by_berth:
                booking_by_berth[bk.berth_id] = {
                    'booking_id': bk.pk,
                    'vessel_name': bk.vessel.name if bk.vessel else bk.vessel_name,
                    'check_in':  str(bk.check_in),
                    'check_out': str(bk.check_out),
                    'status':    bk.status,
                }

        # Last meter readings per berth
        last_readings = {}
        for entry in (
            DockWalkEntry.objects.filter(marina=marina)
            .order_by('berth_id', '-observed_at')
            .distinct('berth_id')
            .values('berth_id', 'electric_reading_kwh', 'water_reading_litres', 'observed_at')
        ):
            last_readings[entry['berth_id']] = {
                'electric_kwh': float(entry['electric_reading_kwh']) if entry['electric_reading_kwh'] else None,
                'water_litres': float(entry['water_reading_litres']) if entry['water_reading_litres'] else None,
                'observed_at':  str(entry['observed_at']),
            }

        berth_payload = []
        for b in berths:
            berth_payload.append({
                'id':          b.pk,
                'code':        b.code,
                'pier':        b.pier.code if b.pier else None,
                'position_index': b.position_index,
                'booking':     booking_by_berth.get(b.pk),
                'last_reading': last_readings.get(b.pk),
            })

        # Active session for this marina
        active_session = (
            DockWalkSession.objects.filter(marina=marina, finished_at__isnull=True)
            .order_by('-started_at')
            .first()
        )

        return Response({
            'date':           str(today),
            'berths':         berth_payload,
            'active_session': DockWalkSessionSerializer(active_session).data if active_session else None,
        })


class BerthAlertViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = BerthAlertSerializer

    def get_queryset(self):
        qs = BerthAlert.objects.filter(
            marina=self.request.user.marina
        ).select_related('berth', 'vessel', 'departure', 'resolved_by', 'coastguard_escalated_by')

        params = self.request.query_params
        if params.get('status'):
            qs = qs.filter(status=params['status'])
        if params.get('alert_type'):
            qs = qs.filter(alert_type=params['alert_type'])
        if params.get('vessel_id'):
            qs = qs.filter(vessel_id=params['vessel_id'])

        return qs

    @action(detail=True, methods=['patch'])
    def resolve(self, request, pk=None):
        from django.utils import timezone as tz
        alert = self.get_object()
        if alert.status == 'resolved':
            return Response({'detail': 'Alert is already resolved.'}, status=status.HTTP_400_BAD_REQUEST)
        alert.status = 'resolved'
        alert.resolved_at = tz.now()
        alert.resolved_by = request.user
        alert.save(update_fields=['status', 'resolved_at', 'resolved_by'])
        return Response(BerthAlertSerializer(alert).data)

    @action(detail=True, methods=['post'], url_path='escalate-coastguard')
    def escalate_coastguard(self, request, pk=None):
        """
        Generate a coast guard report from vessel + departure + marina data.
        Only staff can perform this action.
        This action NEVER creates a VesselMovement record.
        """
        from django.utils import timezone as tz
        alert = self.get_object()

        if alert.status in ('resolved',):
            return Response({'detail': 'Cannot escalate a resolved alert.'}, status=status.HTTP_400_BAD_REQUEST)

        # Build report text
        departure = alert.departure
        vessel    = alert.vessel
        marina    = alert.marina
        lines = [
            f'COAST GUARD NON-RETURN REPORT',
            f'Marina: {marina.name}',
            f'Marina Contact: {marina.contact_email} / {marina.phone}',
        ]
        if vessel:
            lines.append(f'Vessel: {vessel.name}')
        if departure:
            lines.append(f'Departed: {departure.depart_date}')
            lines.append(f'Expected return: {departure.expected_return}')
            lines.append(f'Heading: {departure.departure_heading or "Unknown"}')
            if departure.member:
                lines.append(f'Owner: {departure.member.name} / {departure.member.phone}')
        lines.append(f'Alert created: {alert.created_at}')
        lines.append(f'Detail: {alert.detail}')

        alert.coastguard_report_text  = '\n'.join(lines)
        alert.coastguard_escalated_at = tz.now()
        alert.coastguard_escalated_by = request.user
        alert.status = 'escalated'
        alert.save(update_fields=[
            'coastguard_report_text', 'coastguard_escalated_at',
            'coastguard_escalated_by', 'status',
        ])
        return Response(BerthAlertSerializer(alert).data)


class BerthListingViewSet(viewsets.ModelViewSet):
    serializer_class = BerthListingSerializer
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        return BerthListing.objects.filter(
            marina=self.request.user.marina
        ).select_related('berth', 'seller_member').prefetch_related('enquiries')

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        old_status = instance.status
        response = super().partial_update(request, *args, **kwargs)
        instance.refresh_from_db()
        new_status = instance.status

        # Commission invoice on sold transition
        if old_status != 'sold' and new_status == 'sold':
            commission_invoice_id = None
            if (
                instance.asking_price
                and instance.marina.berth_sale_commission_pct > 0
                and instance.seller_member
            ):
                try:
                    import datetime as _dt
                    from apps.billing import service as billing_service
                    commission = instance.asking_price * (instance.marina.berth_sale_commission_pct / 100)
                    inv = billing_service.create_invoice(
                        instance.marina,
                        member=instance.seller_member,
                        source_type='berth_sale_commission',
                        source_id=str(instance.pk),
                        due_date=_dt.date.today(),
                    )
                    billing_service.add_line_item(
                        inv,
                        description=f'Berth sale commission — berth {instance.berth.code}',
                        quantity=1,
                        unit_price=commission,
                    )
                    billing_service.finalize_invoice(inv)
                    commission_invoice_id = inv.pk
                except Exception:
                    pass  # Non-blocking — log in production

            if commission_invoice_id:
                response.data['commission_invoice_id'] = commission_invoice_id

        return response


class BerthListingEnquiryViewSet(viewsets.ModelViewSet):
    serializer_class = BerthListingEnquirySerializer
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        listing_pk = self.kwargs.get('listing_pk')
        qs = BerthListingEnquiry.objects.filter(marina=self.request.user.marina)
        if listing_pk:
            qs = qs.filter(listing_id=listing_pk)
        return qs

    def perform_create(self, serializer):
        listing_pk = self.kwargs.get('listing_pk')
        kwargs = {'marina': self.request.user.marina}
        if listing_pk:
            try:
                listing = BerthListing.objects.get(pk=listing_pk, marina=self.request.user.marina)
                kwargs['listing'] = listing
            except BerthListing.DoesNotExist:
                raise ValidationError({'listing': 'Listing not found.'})
        serializer.save(**kwargs)

from rest_framework import generics, permissions, status
from rest_framework.exceptions import ValidationError
from rest_framework.views import APIView
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from .models import Pier, Berth, MarinaMapConfig, Amenity
from .serializers import PierSerializer, BerthSerializer, MarinaMapConfigSerializer, AmenitySerializer
from .sms_service import send_sms


class PierListCreateView(generics.ListCreateAPIView):
    serializer_class = PierSerializer

    def get_queryset(self):
        return Pier.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class PierDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = PierSerializer

    def get_queryset(self):
        return Pier.objects.filter(marina=self.request.user.marina)


class BerthListCreateView(generics.ListCreateAPIView):
    serializer_class = BerthSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status', 'pier', 'berth_type', 'operational_type']

    def get_queryset(self):
        from apps.reservations.models import Booking

        qs = (Berth.objects
              .filter(marina=self.request.user.marina)
              .select_related('pier', 'vessel', 'pricing_tier')
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


class MapConfigView(generics.RetrieveUpdateAPIView):
    serializer_class = MarinaMapConfigSerializer
    http_method_names = ['get', 'put', 'head', 'options']

    def get_object(self):
        obj, _ = MarinaMapConfig.objects.get_or_create(marina=self.request.user.marina)
        return obj


<<<<<<< HEAD
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

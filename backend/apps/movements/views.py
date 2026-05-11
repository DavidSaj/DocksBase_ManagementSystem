import csv

from django.utils import timezone
from django.http import HttpResponse
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import VesselMovement
from .serializers import VesselMovementSerializer

ARRIVAL_TYPES = {'arrival', 'temp_return', 'relaunch'}
DEPARTURE_TYPES = {'departure', 'temp_departure', 'haul_out'}


class VesselMovementViewSet(viewsets.ModelViewSet):
    """
    Append-only movement log.  No general PUT/PATCH/DELETE.
    The only mutation is the 'complete' action (sets completed=True + actual_at).
    """
    serializer_class = VesselMovementSerializer
    permission_classes = [IsAuthenticated]

    # Disable the default update/destroy actions
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        qs = VesselMovement.objects.filter(
            marina=self.request.user.marina
        ).select_related('vessel', 'berth_from', 'berth_to', 'recorded_by')

        params = self.request.query_params
        if params.get('date'):
            qs = qs.filter(scheduled_at__date=params['date'])
        if params.get('pier_id'):
            qs = qs.filter(
                berth_from__pier_id=params['pier_id']
            ) | qs.filter(berth_to__pier_id=params['pier_id'])
        if params.get('movement_type'):
            qs = qs.filter(movement_type=params['movement_type'])
        if params.get('completed') is not None:
            qs = qs.filter(completed=params['completed'].lower() in ('true', '1'))

        return qs

    def perform_create(self, serializer):
        serializer.save(
            marina=self.request.user.marina,
            recorded_by=self.request.user,
        )

    @action(detail=True, methods=['patch'], url_path='complete')
    def complete(self, request, pk=None):
        """Mark a movement as completed. Only mutation allowed on existing records."""
        movement = self.get_object()
        if movement.completed:
            return Response(
                {'detail': 'Movement is already completed.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        movement.completed = True
        movement.actual_at = request.data.get('actual_at') or timezone.now()
        movement.save(update_fields=['completed', 'actual_at'])
        return Response(VesselMovementSerializer(movement).data)

    @action(detail=False, methods=['get'], url_path='expected-board')
    def expected_board(self, request):
        """Today's expected movements grouped into arrivals and departures."""
        today = timezone.localdate()
        movements = self.get_queryset().filter(scheduled_at__date=today)

        arrivals = []
        departures = []
        now = timezone.now()

        for m in movements:
            data = VesselMovementSerializer(m).data
            data['overdue'] = (
                m.scheduled_at is not None
                and m.scheduled_at < now
                and not m.completed
            )
            if m.movement_type in ARRIVAL_TYPES:
                arrivals.append(data)
            elif m.movement_type in DEPARTURE_TYPES:
                departures.append(data)

        return Response({'arrivals': arrivals, 'departures': departures})

    @action(detail=False, methods=['get'], url_path='traffic-log')
    def traffic_log(self, request):
        """Date-range movement log with optional CSV export."""
        qs = self.get_queryset()
        date_from = request.query_params.get('date_from')
        date_to   = request.query_params.get('date_to')
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        if request.query_params.get('format') == 'csv':
            response = HttpResponse(content_type='text/csv')
            response['Content-Disposition'] = 'attachment; filename="traffic_log.csv"'
            writer = csv.writer(response)
            writer.writerow([
                'id', 'movement_type', 'vessel', 'berth_from', 'berth_to',
                'scheduled_at', 'actual_at', 'completed', 'recorded_by', 'created_at',
            ])
            for m in qs:
                writer.writerow([
                    m.pk,
                    m.movement_type,
                    str(m.vessel) if m.vessel else '',
                    m.berth_from.code if m.berth_from else '',
                    m.berth_to.code if m.berth_to else '',
                    m.scheduled_at,
                    m.actual_at,
                    m.completed,
                    str(m.recorded_by) if m.recorded_by else '',
                    m.created_at,
                ])
            return response

        return Response(VesselMovementSerializer(qs, many=True).data)

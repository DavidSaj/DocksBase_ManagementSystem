from django.conf import settings
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.channels.models import OTAChannel, OTABooking
from apps.channels.serializers import (
    OTAChannelSerializer, OTAChannelWriteSerializer, OTABookingSerializer,
)


class OTAChannelViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return OTAChannel.objects.filter(marina=self.request.user.marina)

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return OTAChannelWriteSerializer
        return OTAChannelSerializer

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)

    @action(detail=True, methods=['post'])
    def push_availability(self, request, pk=None):
        from django.db import transaction
        from apps.channels.tasks import push_ota_availability_delta
        channel = self.get_object()
        date_from = request.data.get('date_from')
        date_to = request.data.get('date_to')
        if not date_from or not date_to:
            return Response({'error': 'date_from and date_to required'}, status=status.HTTP_400_BAD_REQUEST)
        # Trigger per-berth delta push for all berths in this marina
        berths = list(channel.marina.berths.values_list('id', flat=True))
        for berth_id in berths:
            transaction.on_commit(lambda b=berth_id: push_ota_availability_delta.delay(b, date_from, date_to))
        return Response({'status': f'queued push for {len(berths)} berths'})

    @action(detail=True, methods=['post'])
    def pull_bookings(self, request, pk=None):
        from django.db import transaction
        from apps.channels.tasks import pull_ota_bookings
        transaction.on_commit(lambda: pull_ota_bookings.delay())
        return Response({'status': 'pull queued'})


class OTABookingWebhookView(APIView):
    """
    Inbound OTA booking webhook. AllowAny but validates per-provider token.
    """
    permission_classes = [AllowAny]

    def post(self, request, provider):
        # Validate webhook token
        ota_tokens = getattr(settings, 'OTA_WEBHOOK_TOKENS', {})
        expected_token = ota_tokens.get(provider, '')
        inbound_token = request.headers.get('X-OTA-Token', '') or request.query_params.get('token', '')
        if expected_token and inbound_token != expected_token:
            return Response({'error': 'Unauthorized'}, status=status.HTTP_403_FORBIDDEN)

        # Find the channel
        try:
            channel = OTAChannel.objects.filter(provider=provider, is_active=True).first()
            if not channel:
                return Response({'error': 'No active channel for provider'}, status=status.HTTP_404_NOT_FOUND)
        except Exception:
            return Response(status=status.HTTP_400_BAD_REQUEST)

        from apps.channels.services.ota import handle_ota_webhook
        try:
            handle_ota_webhook(channel, request.data)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response({'status': 'ok'})

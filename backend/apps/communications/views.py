import hashlib
import hmac

from django.conf import settings
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.communications.models import (
    AlertRoute, DotdigitalConfig, DotdigitalSegmentMapping,
    EmailCampaign, Journey, JourneyEnrollment, JourneyStep,
    MessageLog, MessageTemplate, ReviewConfig, ReviewRequest, WhatsAppTemplate,
)
from apps.communications.serializers import (
    AlertRouteSerializer, DotdigitalConfigSerializer,
    DotdigitalSegmentMappingSerializer, EmailCampaignSerializer,
    JourneyEnrollmentSerializer, JourneySerializer, JourneyStepSerializer,
    MessageLogSerializer, MessageTemplateSerializer,
    ReviewConfigSerializer, ReviewRequestSerializer,
    WhatsAppTemplateSerializer,
)


class MessageTemplateViewSet(viewsets.ModelViewSet):
    """CRUD for reusable message templates (email / SMS / WhatsApp)."""
    serializer_class = MessageTemplateSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return MessageTemplate.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class MessageLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = MessageLogSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = MessageLog.objects.filter(marina=self.request.user.marina)
        channel = self.request.query_params.get('channel')
        msg_status = self.request.query_params.get('status')
        if channel:
            qs = qs.filter(channel=channel)
        if msg_status:
            qs = qs.filter(status=msg_status)
        return qs


class WhatsAppTemplateViewSet(viewsets.ModelViewSet):
    serializer_class = WhatsAppTemplateSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return WhatsAppTemplate.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        template = self.get_object()
        template.status = WhatsAppTemplate.Status.PENDING
        template.save(update_fields=['status'])
        return Response({'status': 'submitted'})


class AlertRouteViewSet(viewsets.ModelViewSet):
    serializer_class = AlertRouteSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return AlertRoute.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class JourneyViewSet(viewsets.ModelViewSet):
    serializer_class = JourneySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Journey.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)

    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        journey = self.get_object()
        journey.is_active = True
        journey.save(update_fields=['is_active'])
        return Response({'status': 'activated'})

    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        journey = self.get_object()
        journey.is_active = False
        journey.save(update_fields=['is_active'])
        return Response({'status': 'deactivated'})

    @action(detail=True, methods=['get'])
    def enrollments(self, request, pk=None):
        journey = self.get_object()
        qs = JourneyEnrollment.objects.filter(journey=journey)
        serializer = JourneyEnrollmentSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def analytics(self, request, pk=None):
        journey = self.get_object()
        enrollments = JourneyEnrollment.objects.filter(journey=journey)
        return Response({
            'total': enrollments.count(),
            'active': enrollments.filter(status='active').count(),
            'completed': enrollments.filter(status='completed').count(),
            'cancelled': enrollments.filter(status='cancelled').count(),
            'failed': enrollments.filter(status='failed').count(),
        })


class JourneyStepViewSet(viewsets.ModelViewSet):
    serializer_class = JourneyStepSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return JourneyStep.objects.filter(
            journey__marina=self.request.user.marina,
            journey_id=self.kwargs.get('journey_pk'),
        )

    def perform_create(self, serializer):
        journey = Journey.objects.get(
            pk=self.kwargs['journey_pk'],
            marina=self.request.user.marina,
        )
        serializer.save(journey=journey)


class EmailCampaignViewSet(viewsets.ModelViewSet):
    serializer_class = EmailCampaignSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return EmailCampaign.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)

    @action(detail=True, methods=['post'])
    def send(self, request, pk=None):
        from django.db import transaction
        from apps.communications.tasks import send_scheduled_campaigns
        campaign = self.get_object()
        campaign.status = EmailCampaign.Status.SCHEDULED
        campaign.scheduled_at = timezone.now()
        campaign.save(update_fields=['status', 'scheduled_at'])
        transaction.on_commit(lambda: send_scheduled_campaigns.delay())
        return Response({'status': 'queued'})

    @action(detail=True, methods=['post'])
    def schedule(self, request, pk=None):
        campaign = self.get_object()
        scheduled_at = request.data.get('scheduled_at')
        if not scheduled_at:
            return Response({'error': 'scheduled_at required'}, status=status.HTTP_400_BAD_REQUEST)
        campaign.status = EmailCampaign.Status.SCHEDULED
        campaign.scheduled_at = scheduled_at
        campaign.save(update_fields=['status', 'scheduled_at'])
        return Response({'status': 'scheduled'})


class ReviewRequestListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = ReviewRequest.objects.filter(marina=request.user.marina)
        serializer = ReviewRequestSerializer(qs, many=True)
        return Response(serializer.data)


class ReviewConfigView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        config, _ = ReviewConfig.objects.get_or_create(marina=request.user.marina)
        return Response(ReviewConfigSerializer(config).data)

    def put(self, request):
        config, _ = ReviewConfig.objects.get_or_create(marina=request.user.marina)
        serializer = ReviewConfigSerializer(config, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class DotdigitalConfigView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        config, _ = DotdigitalConfig.objects.get_or_create(
            marina=request.user.marina,
            defaults={'api_username': '', 'api_password': ''},
        )
        return Response(DotdigitalConfigSerializer(config).data)

    def put(self, request):
        config, _ = DotdigitalConfig.objects.get_or_create(
            marina=request.user.marina,
            defaults={'api_username': '', 'api_password': ''},
        )
        serializer = DotdigitalConfigSerializer(config, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class DotdigitalSyncView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from django.db import transaction
        from apps.communications.tasks import sync_dotdigital_segments
        transaction.on_commit(lambda: sync_dotdigital_segments.delay())
        return Response({'status': 'sync queued'})


class DotdigitalSegmentMappingViewSet(viewsets.ModelViewSet):
    serializer_class = DotdigitalSegmentMappingSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return DotdigitalSegmentMapping.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class WhatsAppWebhookView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        """Meta webhook verification handshake."""
        mode = request.query_params.get('hub.mode')
        token = request.query_params.get('hub.verify_token')
        challenge = request.query_params.get('hub.challenge')
        expected_token = getattr(settings, 'WHATSAPP_VERIFY_TOKEN', '')
        if mode == 'subscribe' and token == expected_token:
            return Response(int(challenge))
        return Response(status=status.HTTP_403_FORBIDDEN)

    def post(self, request):
        """Receive incoming WhatsApp messages / status updates."""
        sig = request.headers.get('X-Hub-Signature-256', '')
        secret = getattr(settings, 'WHATSAPP_APP_SECRET', '').encode()
        if secret:
            body = request.body
            expected = 'sha256=' + hmac.new(secret, body, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(sig, expected):
                return Response(status=status.HTTP_403_FORBIDDEN)

        from apps.communications.signals import whatsapp_message_received
        whatsapp_message_received.send(sender=self.__class__, payload=request.data)
        return Response({'status': 'ok'})


class EmailWebhookView(APIView):
    """
    Inbound webhook for email provider delivery events (SendGrid / Mailgun / Postmark).
    Maps event types to MessageLog status updates.
    """
    permission_classes = [AllowAny]

    EVENT_MAP = {
        'delivered': MessageLog.Status.DELIVERED,
        'open':      MessageLog.Status.OPENED,
        'click':     MessageLog.Status.CLICKED,
        'bounce':    MessageLog.Status.BOUNCED,
        'failed':    MessageLog.Status.FAILED,
    }

    def post(self, request):
        events = request.data if isinstance(request.data, list) else [request.data]
        for event in events:
            event_type = event.get('event') or event.get('type', '')
            message_id = event.get('message_id') or event.get('sg_message_id', '')
            new_status = self.EVENT_MAP.get(event_type)
            if new_status and message_id:
                MessageLog.objects.filter(provider_message_id=message_id).update(status=new_status)
        return Response({'status': 'ok'})

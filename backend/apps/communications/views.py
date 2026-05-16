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
    AlertRoute, Broadcast, BroadcastRecipient,
    DotdigitalConfig, DotdigitalSegmentMapping,
    EmailCampaign, Journey, JourneyEnrollment, JourneyStep,
    MessageLog, MessageTemplate, ReviewConfig, ReviewRequest, WhatsAppTemplate,
)
from apps.communications.serializers import (
    AlertRouteSerializer, BroadcastSerializer, BroadcastRecipientSerializer,
    DotdigitalConfigSerializer,
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


class BroadcastViewSet(viewsets.ModelViewSet):
    """
    Manager-initiated boater broadcasts (SMS or email).
    See docs/superpowers/specs/2026-05-15-broadcast-center-design.md §14.
    """
    serializer_class = BroadcastSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Broadcast.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina, created_by=self.request.user)

    @action(detail=True, methods=['post'])
    def preview(self, request, pk=None):
        from apps.communications.services.broadcast import preview as preview_service
        broadcast = self.get_object()
        result = preview_service(broadcast)
        broadcast.refresh_from_db()
        return Response({
            'count': result['count'],
            'cost_cents': result['cost_cents'],
            'previewed_count': broadcast.previewed_count,
            'cost_estimate_cents': broadcast.cost_estimate_cents,
        })

    @action(detail=True, methods=['post'])
    def send(self, request, pk=None):
        from apps.communications.services.broadcast import (
            check_and_send, CohortDriftError,
        )
        broadcast = self.get_object()
        try:
            dispatched = check_and_send(broadcast)
        except CohortDriftError as e:
            return Response(
                {
                    'detail': (
                        f'Cohort size has changed from {e.previewed} to {e.new}. '
                        f'Please refresh your preview to confirm the new cost.'
                    ),
                    'previewed_count': e.previewed,
                    'new_count': e.new,
                },
                status=status.HTTP_409_CONFLICT,
            )
        return Response({'status': 'sent', 'dispatched': dispatched})

    @action(detail=True, methods=['get'])
    def deliveries(self, request, pk=None):
        broadcast = self.get_object()
        qs = BroadcastRecipient.objects.filter(broadcast=broadcast)
        return Response(BroadcastRecipientSerializer(qs, many=True).data)


class TwilioSmsWebhookView(APIView):
    """
    Inbound Twilio SMS webhook (spec §14.B).

    Validates the X-Twilio-Signature header against TWILIO_AUTH_TOKEN, then
    parses the inbound Body for STOP-family keywords. On match, flips
    Member.broadcast_opt_in = False for the matching `From` phone.
    """
    permission_classes = [AllowAny]

    def _validate_signature(self, request) -> bool:
        token = getattr(settings, 'TWILIO_AUTH_TOKEN', '') or ''
        if not token:
            # No token configured -> skip validation (dev). Production
            # deployments must set TWILIO_AUTH_TOKEN.
            return True
        sig = request.headers.get('X-Twilio-Signature', '')
        if not sig:
            return False
        try:
            from twilio.request_validator import RequestValidator
        except ImportError:
            return False
        validator = RequestValidator(token)
        url = request.build_absolute_uri()
        params = request.POST.dict() if request.POST else (request.data or {})
        return validator.validate(url, params, sig)

    def post(self, request):
        from apps.communications.services.broadcast import STOP_KEYWORDS
        from apps.members.models import Member

        if not self._validate_signature(request):
            return Response(status=status.HTTP_403_FORBIDDEN)

        data = request.POST if request.POST else (request.data or {})
        from_number = (data.get('From') or '').strip()
        body = (data.get('Body') or '').strip()
        body_upper = body.upper()
        first_word = body_upper.split()[0] if body_upper else ''

        if first_word in STOP_KEYWORDS and from_number:
            Member.objects.filter(phone=from_number).update(broadcast_opt_in=False)

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

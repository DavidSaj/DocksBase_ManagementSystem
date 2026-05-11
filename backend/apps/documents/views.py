import json
import hmac
import hashlib
from django.conf import settings
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import DocTemplate, Envelope, MemberDocument
from .serializers import DocTemplateSerializer, EnvelopeSerializer, MemberDocumentSerializer
from .services import create_embedded_template_draft, send_envelope, get_signed_pdf_url


class DocTemplateList(generics.ListCreateAPIView):
    serializer_class = DocTemplateSerializer

    def get_queryset(self):
        return DocTemplate.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class DocTemplateDetail(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = DocTemplateSerializer

    def get_queryset(self):
        return DocTemplate.objects.filter(marina=self.request.user.marina)


class DocTemplatePrepare(APIView):
    def post(self, request, pk):
        try:
            template = DocTemplate.objects.get(pk=pk, marina=request.user.marina)
        except DocTemplate.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not template.file:
            return Response({'detail': 'No file uploaded yet.'}, status=status.HTTP_400_BAD_REQUEST)
        edit_url = create_embedded_template_draft(template, template.file.path)
        return Response({'edit_url': edit_url})


class DocTemplateSetWaiver(APIView):
    def post(self, request, pk):
        try:
            template = DocTemplate.objects.get(pk=pk, marina=request.user.marina)
        except DocTemplate.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not template.dropboxsign_template_id:
            return Response(
                {'detail': 'Template must be prepared for eSign before it can be set as the marina waiver.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        marina = request.user.marina
        marina.waiver_template_id = template.dropboxsign_template_id
        marina.save(update_fields=['waiver_template_id'])
        return Response({'waiver_template_id': marina.waiver_template_id})

    def delete(self, request, pk):
        try:
            template = DocTemplate.objects.get(pk=pk, marina=request.user.marina)
        except DocTemplate.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        marina = request.user.marina
        if marina.waiver_template_id == template.dropboxsign_template_id:
            marina.waiver_template_id = None
            marina.save(update_fields=['waiver_template_id'])
        return Response(status=status.HTTP_204_NO_CONTENT)


class EnvelopeList(generics.ListCreateAPIView):
    serializer_class = EnvelopeSerializer

    def get_queryset(self):
        return Envelope.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        envelope = serializer.save(marina=self.request.user.marina)
        request_id = send_envelope(envelope)
        envelope.dropboxsign_request_id = request_id
        envelope.save(update_fields=['dropboxsign_request_id'])


class EnvelopeDetail(generics.RetrieveAPIView):
    serializer_class = EnvelopeSerializer

    def get_queryset(self):
        return Envelope.objects.filter(marina=self.request.user.marina)


class EnvelopeDownload(APIView):
    def get(self, request, pk):
        try:
            envelope = Envelope.objects.get(pk=pk, marina=request.user.marina)
        except Envelope.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if envelope.status != 'completed':
            return Response({'detail': 'Not yet signed.'}, status=status.HTTP_400_BAD_REQUEST)
        url = get_signed_pdf_url(envelope.dropboxsign_request_id)
        return Response({'url': url})


class MemberDocumentList(generics.ListCreateAPIView):
    serializer_class = MemberDocumentSerializer

    def get_queryset(self):
        return MemberDocument.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class MemberDocumentDetail(generics.RetrieveUpdateAPIView):
    serializer_class = MemberDocumentSerializer

    def get_queryset(self):
        return MemberDocument.objects.filter(marina=self.request.user.marina)


def _parse_webhook_body(body: str):
    """Parse webhook body — supports both JSON and form-encoded."""
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        pass
    try:
        import urllib.parse
        parsed = urllib.parse.parse_qs(body)
        return json.loads(parsed['json'][0])
    except (KeyError, json.JSONDecodeError, IndexError):
        return None


def _verify_hmac(secret: str, event_time: str, event_type: str, received_sig: str) -> bool:
    expected = hmac.new(secret.encode(), (event_time + event_type).encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, received_sig)


class DropboxSignWebhook(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        secret = settings.DROPBOX_SIGN_WEBHOOK_SECRET
        event_time = request.META.get('HTTP_X_HELLOSIGN_EVENT_TIME', '')
        received_sig = request.META.get('HTTP_X_HELLOSIGN_SIGNATURE', '')

        body = request.body.decode('utf-8')
        payload = _parse_webhook_body(body)
        if not payload:
            return Response({'detail': 'Malformed payload.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            event = payload['event']
            event_type = event['event_type']
        except (KeyError, TypeError):
            return Response({'detail': 'Malformed payload.'}, status=status.HTTP_400_BAD_REQUEST)

        if not secret or not _verify_hmac(secret, event_time, event_type, received_sig):
            return Response({'detail': 'Invalid signature.'}, status=status.HTTP_400_BAD_REQUEST)

        if event_type == 'signature_request_all_signed':
            sig_req = event.get('signature_request', {})
            metadata = sig_req.get('metadata', {})
            marina_id = metadata.get('marina_id')
            envelope_pk = metadata.get('envelope_pk')
            if not marina_id or not envelope_pk:
                return Response({'detail': 'Missing metadata.'}, status=status.HTTP_400_BAD_REQUEST)
            try:
                envelope = Envelope.objects.get(pk=envelope_pk, marina_id=marina_id)
            except Envelope.DoesNotExist:
                return Response({'detail': 'Envelope not found.'}, status=status.HTTP_400_BAD_REQUEST)
            envelope.status = 'completed'
            envelope.completed_at = timezone.now()
            envelope.save(update_fields=['status', 'completed_at'])

        elif event_type == 'template_created':
            template_data = event.get('template', {})
            metadata = template_data.get('metadata', {})
            marina_id = metadata.get('marina_id')
            template_pk = metadata.get('template_pk')
            dsign_template_id = template_data.get('template_id', '')
            if not marina_id or not template_pk:
                return Response({'detail': 'Missing metadata.'}, status=status.HTTP_400_BAD_REQUEST)
            try:
                tpl = DocTemplate.objects.get(pk=template_pk, marina_id=marina_id)
            except DocTemplate.DoesNotExist:
                return Response({'detail': 'Template not found.'}, status=status.HTTP_400_BAD_REQUEST)
            tpl.dropboxsign_template_id = dsign_template_id
            tpl.save(update_fields=['dropboxsign_template_id'])

        return Response({'hash': 'hello api event received'})

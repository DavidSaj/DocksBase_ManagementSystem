import hashlib
import hmac as _hmac
import json as _json
import logging

_log = logging.getLogger(__name__)

from django.core import signing
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Marina
from apps.reservations.models import Booking
from apps.documents.models import DocTemplate
from apps.documents.services import create_embedded_sign_url, get_existing_embedded_sign_url
from .checkin_auth import PortalTokenAuthentication
from .checkin_serializers import PortalBookingSerializer
from .checkin_utils import (
    decode_magic_token, make_portal_token,
    evaluate_pre_cleared,
)

_DS_ACK = 'Hello API Event Received'
_DS_ALL_SIGNED = 'signature_request_all_signed'


def _verify_ds_hmac(api_key: str, event_time: str, event_type: str, event_hash: str) -> bool:
    msg = (str(event_time) + event_type).encode()
    computed = _hmac.new(api_key.encode(), msg, hashlib.sha256).hexdigest()
    return _hmac.compare_digest(computed, event_hash)


class MagicAuthView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        token = request.data.get('token')
        if not token:
            return Response({'detail': 'token required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = decode_magic_token(token)
        except signing.BadSignature as e:
            _log.warning('MagicAuth BAD_SIGNATURE: %s | token_prefix=%s', e, (token or '')[:30])
            return Response({'detail': 'Invalid or expired link.'}, status=status.HTTP_401_UNAUTHORIZED)

        _log.info('MagicAuth decoded OK: booking_id=%s email=%s', payload.get('booking_id'), payload.get('boater_email'))
        try:
            booking = Booking.objects.select_related('marina').get(
                pk=payload['booking_id'],
                guest_email=payload['boater_email'],
            )
        except Booking.DoesNotExist:
            _log.warning('MagicAuth BOOKING_NOT_FOUND: booking_id=%s email=%s', payload.get('booking_id'), payload.get('boater_email'))
            return Response({'detail': 'Booking not found.'}, status=status.HTTP_401_UNAUTHORIZED)

        session_token = make_portal_token(
            booking_id=booking.id,
            marina_slug=booking.marina.slug,
            boater_email=booking.guest_email,
        )
        return Response({
            'token': session_token,
            'booking_id': booking.id,
            'marina_slug': booking.marina.slug,
        })


class PortalBookingMixin:
    authentication_classes = [PortalTokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get_booking(self, request, pk):
        if request.user.booking_id != pk:
            return None, Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
        try:
            return Booking.objects.select_related('marina', 'berth', 'berth__pier').get(pk=pk), None
        except Booking.DoesNotExist:
            return None, Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)


class PortalBookingView(PortalBookingMixin, APIView):
    def get(self, request, pk):
        booking, err = self.get_booking(request, pk)
        if err:
            return err
        return Response(PortalBookingSerializer(booking).data)


class PatchDimensionsView(PortalBookingMixin, APIView):
    def patch(self, request, pk):
        booking, err = self.get_booking(request, pk)
        if err:
            return err

        allowed = {'boat_loa', 'boat_beam', 'boat_draft'}
        fields_to_save = list(allowed & set(request.data.keys()))
        for field in fields_to_save:
            setattr(booking, field, request.data[field])
        if fields_to_save:
            booking.save(update_fields=fields_to_save)

        evaluate_pre_cleared(booking)
        booking.refresh_from_db()
        return Response(PortalBookingSerializer(booking).data)


class SelfCheckinView(PortalBookingMixin, APIView):
    def post(self, request, pk):
        booking, err = self.get_booking(request, pk)
        if err:
            return err

        if not booking.pre_cleared:
            return Response(
                {'detail': 'Pre-clearance not complete.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not booking.self_checked_in:
            booking.self_checked_in = True
            booking.self_checked_in_at = timezone.now()
            booking.status = 'checked_in'
            booking.save(update_fields=['self_checked_in', 'self_checked_in_at', 'status'])

        return Response(PortalBookingSerializer(booking).data)


class WaiverView(PortalBookingMixin, APIView):
    def _get_waiver_template(self, marina):
        if not marina.waiver_template_id:
            return None
        try:
            return DocTemplate.objects.get(marina=marina, id=int(marina.waiver_template_id))
        except (DocTemplate.DoesNotExist, ValueError, TypeError):
            return None

    def _uses_esign(self, marina, tpl):
        return bool(
            marina.dropboxsign_api_key
            and marina.dropboxsign_client_id
            and tpl.dropboxsign_template_id
        )

    def _get_or_create_sign_url(self, booking, tpl) -> str:
        marina = booking.marina
        if booking.waiver_envelope_id:
            return get_existing_embedded_sign_url(
                booking.waiver_envelope_id,
                api_key=marina.dropboxsign_api_key,
            )
        request_id, sign_url = create_embedded_sign_url(
            booking,
            tpl.dropboxsign_template_id,
            api_key=marina.dropboxsign_api_key,
            client_id=marina.dropboxsign_client_id,
        )
        booking.waiver_envelope_id = request_id
        booking.save(update_fields=['waiver_envelope_id'])
        return sign_url

    def get(self, request, pk):
        booking, err = self.get_booking(request, pk)
        if err:
            return err

        tpl = self._get_waiver_template(booking.marina)
        if not tpl or not tpl.file:
            return Response(
                {'detail': 'No waiver document available for this marina.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        waiver_url = tpl.file.url

        if not self._uses_esign(booking.marina, tpl):
            return Response({'mode': 'clickwrap', 'waiver_url': waiver_url})

        sign_url = self._get_or_create_sign_url(booking, tpl)
        return Response({'mode': 'esign', 'waiver_url': waiver_url, 'sign_url': sign_url})

    def post(self, request, pk):
        booking, err = self.get_booking(request, pk)
        if err:
            return err

        tpl = self._get_waiver_template(booking.marina)
        if not tpl:
            return Response(
                {'detail': 'No waiver template configured for this marina.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if self._uses_esign(booking.marina, tpl):
            sign_url = self._get_or_create_sign_url(booking, tpl)
            return Response({'sign_url': sign_url})

        # Click-wrap path
        if not booking.waiver_signed:
            booking.waiver_signed = True
            booking.save(update_fields=['waiver_signed'])
            evaluate_pre_cleared(booking)
            booking.refresh_from_db()

        return Response(PortalBookingSerializer(booking).data)



class DropboxSignWebhookView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request, marina_slug):
        # 1. Resolve marina from URL — never from the payload.
        try:
            marina = Marina.objects.get(slug=marina_slug)
        except Marina.DoesNotExist:
            return Response({'detail': 'not found.'}, status=status.HTTP_404_NOT_FOUND)

        # 2. Require a configured API key — fail hard, never open.
        api_key = marina.dropboxsign_api_key
        if not api_key:
            _log.warning('DropboxSign webhook: no API key for marina %s', marina_slug)
            return Response({'detail': 'webhook not configured.'}, status=status.HTTP_401_UNAUTHORIZED)

        # 3. Parse body. DS posts form-encoded with a 'json' field.
        raw = request.data.get('json', '')
        try:
            payload = _json.loads(raw) if isinstance(raw, str) else (raw or {})
        except (ValueError, TypeError):
            return Response({'detail': 'invalid payload.'}, status=status.HTTP_400_BAD_REQUEST)

        event = payload.get('event', {})
        event_type = event.get('event_type', '')
        event_time = str(event.get('event_time', ''))
        event_hash = event.get('event_hash', '')

        # 4. Validate HMAC — fail hard on mismatch.
        if not _verify_ds_hmac(api_key, event_time, event_type, event_hash):
            _log.warning('DropboxSign webhook: HMAC mismatch for marina %s', marina_slug)
            return Response({'detail': 'invalid signature.'}, status=status.HTTP_401_UNAUTHORIZED)

        # 5. Acknowledge non-target events — DS sends several types.
        if event_type != _DS_ALL_SIGNED:
            return HttpResponse(_DS_ACK)

        # 6. Process the booking.
        sig_request = payload.get('signature_request', {})
        metadata = sig_request.get('metadata', {})
        booking_id = metadata.get('booking_id')

        if not booking_id:
            _log.warning('DropboxSign webhook: missing booking_id in metadata, marina %s', marina_slug)
            return HttpResponse(_DS_ACK)

        try:
            booking = Booking.objects.get(pk=booking_id, marina=marina)
        except Booking.DoesNotExist:
            _log.warning('DropboxSign webhook: booking %s not found for marina %s', booking_id, marina_slug)
            return HttpResponse(_DS_ACK)

        if not booking.waiver_signed:
            booking.waiver_signed = True
            booking.save(update_fields=['waiver_signed'])
            evaluate_pre_cleared(booking)

        return HttpResponse(_DS_ACK)


class InsuranceUploadView(PortalBookingMixin, APIView):
    parser_classes = [MultiPartParser]

    def post(self, request, pk):
        booking, err = self.get_booking(request, pk)
        if err:
            return err

        file = request.FILES.get('file')
        if not file:
            return Response({'detail': 'file required.'}, status=status.HTTP_400_BAD_REQUEST)

        booking.insurance_doc = file
        booking.save(update_fields=['insurance_doc'])
        return Response(PortalBookingSerializer(booking).data)

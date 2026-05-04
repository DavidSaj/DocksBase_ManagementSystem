import datetime
import hmac
import hashlib

import dropbox_sign
from dropbox_sign import ApiClient, Configuration, apis, models as ds_models

from django.conf import settings
from django.core import signing
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.reservations.models import Booking
from .checkin_auth import PortalTokenAuthentication
from .checkin_serializers import PortalBookingSerializer
from .checkin_utils import (
    decode_magic_token, make_portal_token,
    evaluate_pre_cleared,
)


class MagicAuthView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        token = request.data.get('token')
        if not token:
            return Response({'detail': 'token required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = decode_magic_token(token)
        except signing.BadSignature:
            return Response({'detail': 'Invalid or expired link.'}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            booking = Booking.objects.select_related('marina').get(
                pk=payload['booking_id'],
                guest_email=payload['boater_email'],
            )
        except Booking.DoesNotExist:
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


def is_valid_dropbox_sign_request(request_body: bytes, secret: str) -> bool:
    try:
        from dropbox_sign import EventCallbackHelper
        return EventCallbackHelper.is_valid_request(request_body, secret)
    except Exception:
        return False


def get_sign_url(booking, template_id, client_id, api_key):
    configuration = Configuration(username=api_key)
    with ApiClient(configuration) as api_client:
        sig_api = apis.SignatureRequestApi(api_client)
        embedded_api = apis.EmbeddedApi(api_client)

        data = ds_models.SignatureRequestCreateEmbeddedWithTemplateRequest(
            client_id=client_id,
            template_ids=[template_id],
            subject='Marina Waiver',
            signers=[
                ds_models.SubSignatureRequestTemplateSigner(
                    role='Boater',
                    name=booking.guest_name or 'Boater',
                    email_address=booking.guest_email,
                )
            ],
            metadata={'booking_id': str(booking.id)},
        )
        sig_response = sig_api.signature_request_create_embedded_with_template(data)
        envelope_id = sig_response.signature_request.signature_request_id
        signature_id = sig_response.signature_request.signatures[0].signature_id

        url_response = embedded_api.embedded_sign_url(signature_id)
        sign_url = url_response.embedded.sign_url

    return envelope_id, sign_url


def get_existing_sign_url(envelope_id, api_key):
    configuration = Configuration(username=api_key)
    with ApiClient(configuration) as api_client:
        sig_api = apis.SignatureRequestApi(api_client)
        embedded_api = apis.EmbeddedApi(api_client)
        sig_response = sig_api.signature_request_get(envelope_id)
        signature_id = sig_response.signature_request.signatures[0].signature_id
        url_response = embedded_api.embedded_sign_url(signature_id)
        return url_response.embedded.sign_url


class WaiverView(PortalBookingMixin, APIView):
    def post(self, request, pk):
        booking, err = self.get_booking(request, pk)
        if err:
            return err

        if not booking.marina.waiver_template_id:
            return Response(
                {'detail': 'No waiver template configured for this marina.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        api_key = settings.DROPBOX_SIGN_API_KEY
        client_id = settings.DROPBOX_SIGN_CLIENT_ID

        if booking.waiver_envelope_id:
            sign_url = get_existing_sign_url(booking.waiver_envelope_id, api_key)
        else:
            envelope_id, sign_url = get_sign_url(
                booking, booking.marina.waiver_template_id, client_id, api_key
            )
            booking.waiver_envelope_id = envelope_id
            booking.save(update_fields=['waiver_envelope_id'])

        return Response({'sign_url': sign_url})


class DropboxSignWebhookView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        if not is_valid_dropbox_sign_request(request.body, settings.DROPBOX_SIGN_WEBHOOK_SECRET):
            return Response({'detail': 'Invalid signature.'}, status=status.HTTP_403_FORBIDDEN)

        payload = request.data
        event_type = payload.get('event', {}).get('event_type', '')

        if event_type != 'signature_request_all_signed':
            return Response({'status': 'ignored'})

        booking_id = payload.get('signature_request', {}).get('metadata', {}).get('booking_id')
        if not booking_id:
            return Response({'status': 'no booking_id in metadata'})

        try:
            booking = Booking.objects.get(pk=int(booking_id))
        except (Booking.DoesNotExist, ValueError):
            return Response({'status': 'booking not found'})

        booking.waiver_signed = True
        booking.save(update_fields=['waiver_signed'])
        evaluate_pre_cleared(booking)

        return Response({'status': 'ok'})


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

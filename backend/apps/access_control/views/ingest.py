"""
apps/access_control/views/ingest.py

Hardware → DocksBase webhook ingest endpoints.
All three return 204 No Content on success.

Auth: HMAC-SHA256 X-DocksBase-Signature header against marina.features['access_webhook_secret'].
"""

import hashlib
import hmac
import logging

from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.accounts.models import Marina

logger = logging.getLogger(__name__)


def _verify_hmac(request, secret: str) -> bool:
    """Validate X-DocksBase-Signature header against HMAC-SHA256 of request body."""
    sig      = request.headers.get('X-DocksBase-Signature', '')
    expected = hmac.new(secret.encode(), request.body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)


def _get_marina_from_request(request) -> Marina | None:
    """Extract marina from X-DocksBase-Marina-ID header."""
    marina_id = request.headers.get('X-DocksBase-Marina-ID')
    if not marina_id:
        return None
    try:
        return Marina.objects.get(pk=marina_id)
    except Marina.DoesNotExist:
        return None


@api_view(['POST'])
@permission_classes([AllowAny])
def rfid_ingest(request):
    """
    Ingest RFID card read events from hardware readers.
    Payload: { "reader_uid": str, "card_uid": str, "occurred_at": ISO-8601 }
    """
    marina = _get_marina_from_request(request)
    if not marina:
        return Response(status=status.HTTP_403_FORBIDDEN)

    secret = marina.features.get('access_webhook_secret', '')
    if secret and not _verify_hmac(request, secret):
        return Response(status=status.HTTP_403_FORBIDDEN)

    payload    = request.data
    reader_uid = payload.get('reader_uid', '')
    card_uid   = payload.get('card_uid', '').upper()
    occurred_at = payload.get('occurred_at', timezone.now().isoformat())

    from apps.access_control.models import AccessCard, AccessEvent, AccessReader

    try:
        reader = AccessReader.objects.get(marina=marina, reader_uid=reader_uid)
    except AccessReader.DoesNotExist:
        logger.warning("rfid_ingest: unknown reader_uid=%s marina=%s", reader_uid, marina.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)

    card   = AccessCard.objects.filter(marina=marina, card_uid=card_uid, is_active=True).first()
    member = card.member if card else None

    granted = card is not None
    AccessEvent.objects.create(
        marina=marina,
        reader=reader,
        credential_type='card',
        card=card,
        member=member,
        raw_credential=card_uid,
        granted=granted,
        denial_reason='' if granted else 'Card not recognised or inactive',
        occurred_at=occurred_at,
    )
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@permission_classes([AllowAny])
def anpr_ingest(request):
    """
    Ingest ANPR plate-read events from cameras.
    Redis debounce: suppresses duplicate frames within anpr_debounce_seconds (default 60).
    Confidence floor: drops reads below anpr_confidence_threshold (default 0.85).
    """
    marina = _get_marina_from_request(request)
    if not marina:
        return Response(status=status.HTTP_403_FORBIDDEN)

    secret = marina.features.get('access_webhook_secret', '')
    if secret and not _verify_hmac(request, secret):
        return Response(status=status.HTTP_403_FORBIDDEN)

    from apps.access_control.hal.factory import get_anpr_adapter
    from apps.access_control.models import ANPRCamera, ANPREvent, VehicleRegistration

    adapter    = get_anpr_adapter(marina)
    payload    = adapter.normalise(request.data)

    camera_uid = payload.get('camera_uid', '')
    plate      = payload.get('plate', '').upper().replace(' ', '')
    confidence = float(payload.get('confidence', 1.0))

    # Confidence floor
    threshold = marina.features.get('anpr_confidence_threshold', 0.85)
    if confidence < threshold:
        logger.debug("anpr_ingest: confidence %.3f below threshold %.3f — dropped", confidence, threshold)
        return Response(status=status.HTTP_204_NO_CONTENT)

    # Redis debounce — suppress duplicate frames from the same vehicle pass
    ttl          = marina.features.get('anpr_debounce_seconds', 60)
    debounce_key = f"anpr:{marina.pk}:{camera_uid}:{plate}"
    if not cache.add(debounce_key, '1', timeout=ttl):
        logger.debug("anpr_ingest: debounce hit for plate=%s camera=%s — dropped", plate, camera_uid)
        return Response(status=status.HTTP_204_NO_CONTENT)

    # First frame in window — create ANPREvent and trigger gate logic
    try:
        camera = ANPRCamera.objects.get(marina=marina, camera_uid=camera_uid)
    except ANPRCamera.DoesNotExist:
        camera = None

    vehicle = VehicleRegistration.objects.filter(marina=marina, plate_number=plate, is_active=True).first()
    member  = vehicle.member if vehicle else None

    ANPREvent.objects.create(
        marina=marina,
        camera=camera,
        plate_detected=plate,
        vehicle=vehicle,
        matched_member=member,
        access_granted=vehicle is not None,
        confidence=confidence,
        occurred_at=timezone.now(),
    )

    # TODO: trigger gate open if member is authorised
    # trigger_gate_if_authorised(marina, plate)

    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@permission_classes([AllowAny])
def biometric_ingest(request):
    """
    Ingest biometric authentication events from terminals.
    Payload: { "terminal_uid": str, "template_handle": str, "occurred_at": ISO-8601, "granted": bool }
    """
    marina = _get_marina_from_request(request)
    if not marina:
        return Response(status=status.HTTP_403_FORBIDDEN)

    secret = marina.features.get('access_webhook_secret', '')
    if secret and not _verify_hmac(request, secret):
        return Response(status=status.HTTP_403_FORBIDDEN)

    payload      = request.data
    terminal_uid = payload.get('terminal_uid', '')
    granted      = bool(payload.get('granted', False))
    occurred_at  = payload.get('occurred_at', timezone.now().isoformat())

    from apps.access_control.models import AccessEvent, AccessReader, BiometricEnrolment

    reader  = AccessReader.objects.filter(marina=marina, reader_uid=terminal_uid).first()
    enrol   = BiometricEnrolment.objects.filter(marina=marina, terminal_uid=terminal_uid).first()
    member  = enrol.member if enrol else None

    AccessEvent.objects.create(
        marina=marina,
        reader=reader,
        credential_type='face',
        member=member,
        raw_credential='biometric',
        granted=granted,
        denial_reason='' if granted else 'Biometric not matched',
        occurred_at=occurred_at,
    )
    return Response(status=status.HTTP_204_NO_CONTENT)

from datetime import timedelta
from django.db import transaction
from django.db.models import Sum
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.common.captcha import verify as verify_captcha, CaptchaInvalid
from apps.accounts.models import Marina

from .models import Activity, ActivityBooking
from .services.slots import materialise_slots
from .public_serializers import (
    PublicActivitySerializer, PublicActivityRequestSerializer,
)


class PublicActivityListView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        slug = request.query_params.get('marina')
        if not slug:
            return Response({'detail': '?marina= is required.'}, status=400)
        try:
            marina = Marina.objects.get(slug=slug)
        except Marina.DoesNotExist:
            return Response({'detail': 'Marina not found.'}, status=404)
        qs = (
            Activity.objects.filter(marina=marina, is_active=True)
            .prefetch_related('pricing_rules__chargeable_item')
        )
        return Response(PublicActivitySerializer(qs, many=True).data)


class PublicActivitySlotsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, activity_id):
        try:
            activity = Activity.objects.get(pk=activity_id, is_active=True)
        except Activity.DoesNotExist:
            return Response({'detail': 'Activity not found.'}, status=404)
        d_from = request.query_params.get('from')
        d_to   = request.query_params.get('to')
        if not d_from or not d_to:
            return Response({'detail': '?from and ?to are required (YYYY-MM-DD).'}, status=400)
        try:
            slots = materialise_slots(activity, d_from, d_to)
        except ValueError:
            return Response({'detail': 'Invalid date format.'}, status=400)
        return Response({'slots': slots})


class PublicActivityRequestView(APIView):
    permission_classes = [AllowAny]
    throttle_classes   = [ScopedRateThrottle]
    throttle_scope     = 'public_activity_request'

    def post(self, request):
        s = PublicActivityRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = s.validated_data

        try:
            verify_captcha(data['captcha_token'], remote_ip=request.META.get('REMOTE_ADDR', ''))
        except CaptchaInvalid as exc:
            return Response({'detail': 'captcha_failed', 'reason': str(exc)}, status=400)

        try:
            marina = Marina.objects.get(slug=data['marina_slug'])
        except Marina.DoesNotExist:
            return Response({'detail': 'Marina not found.'}, status=404)

        with transaction.atomic():
            try:
                activity = (
                    Activity.objects.select_for_update()
                    .get(pk=data['activity_id'], marina=marina, is_active=True)
                )
            except Activity.DoesNotExist:
                return Response({'detail': 'Activity not found.'}, status=404)

            start_dt = data['start_datetime']
            booked = ActivityBooking.objects.filter(
                activity=activity, start_datetime=start_dt,
                status__in=[
                    ActivityBooking.Status.CONFIRMED,
                    ActivityBooking.Status.REQUESTED,
                ],
            ).aggregate(t=Sum('participant_count'))['t'] or 0

            if booked + data['participant_count'] > activity.capacity_max:
                return Response({'detail': 'Slot no longer available'}, status=409)

            booking = ActivityBooking.objects.create(
                marina=marina,
                activity=activity,
                start_datetime=start_dt,
                end_datetime=start_dt + timedelta(minutes=activity.duration_minutes),
                participant_count=data['participant_count'],
                status=ActivityBooking.Status.REQUESTED,
                payment_mode=ActivityBooking.PaymentMode.DIRECT,
                lead_name=data['lead_name'],
                lead_email=data['lead_email'],
                lead_phone=data.get('lead_phone', ''),
                notes=data.get('notes', ''),
            )

        return Response({'id': booking.pk, 'status': booking.status}, status=201)

# backend/apps/reservations/serializers.py
from rest_framework import serializers

from apps.accounts.billing_gates import (
    ACTION_CREATE_BOOKING,
    ACTION_MUTATE_BOOKING,
    assert_marina_can,
)

from .models import Booking, BookingRequest, Reservation, ReservationItem


class BookingSerializer(serializers.ModelSerializer):
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default=None)
    berth_code  = serializers.CharField(source='berth.code',  read_only=True, default=None)
    owner_name  = serializers.CharField(source='vessel.owner.name', read_only=True, default=None)
    invoice_id     = serializers.SerializerMethodField()
    invoice_status = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = [
            'id', 'berth', 'berth_code', 'vessel', 'vessel_name', 'owner_name',
            'booking_type', 'check_in', 'check_out', 'nights', 'amount',
            'status', 'paid', 'notes',
            'guest_name', 'guest_email', 'guest_phone',
            'boat_loa', 'boat_beam', 'boat_draft',
            'invoice_id', 'invoice_status',
            'created_at',
        ]
        read_only_fields = [
            'id', 'vessel_name', 'berth_code', 'owner_name',
            'nights', 'amount', 'paid',  # paid is now derived from invoice payment
            'invoice_id', 'invoice_status', 'created_at',
        ]

    def validate(self, data):
        """Billing-state gate (TD4).

        Layered above the BillingGateMiddleware 402 so the API returns a
        specific 400 with a UX-grade message ("subscription is restricted —
        new bookings cannot be created") instead of the middleware's generic
        ``marina_billing_blocked`` payload. The middleware remains the
        defence-in-depth catch-all for paths without a serializer.
        """
        request = self.context.get('request')
        marina = getattr(getattr(request, 'user', None), 'marina', None)
        if marina is not None:
            action = ACTION_CREATE_BOOKING if self.instance is None else ACTION_MUTATE_BOOKING
            assert_marina_can(marina, action)
        return data

    def _latest_invoice(self, obj):
        # Prefer the direct FK link; fall back to source_type lookup.
        cached = getattr(obj, '_latest_invoice', None)
        if cached is not None:
            return cached or None
        try:
            inv = obj.invoices.order_by('-created_at').first()
        except Exception:
            inv = None
        if inv is None:
            from apps.billing.models import Invoice
            inv = (
                Invoice.objects
                .filter(source_type='berth_booking', source_id=str(obj.pk))
                .order_by('-created_at')
                .first()
            )
        obj._latest_invoice = inv or False
        return inv

    def get_invoice_id(self, obj):
        inv = self._latest_invoice(obj)
        return inv.pk if inv else None

    def get_invoice_status(self, obj):
        inv = self._latest_invoice(obj)
        return inv.status if inv else None


class BookingEngineRequestSerializer(serializers.Serializer):
    check_in   = serializers.DateField()
    check_out  = serializers.DateField()
    boat_loa   = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, allow_null=True)
    boat_beam  = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    boat_draft = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    guest_name  = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    guest_email = serializers.EmailField(required=False, allow_blank=True, default='')
    guest_phone = serializers.CharField(max_length=50, required=False, allow_blank=True, default='')

    def validate(self, data):
        if data['check_out'] <= data['check_in']:
            raise serializers.ValidationError('check_out must be after check_in.')
        return data


class AssignBerthSerializer(serializers.Serializer):
    berth_id = serializers.IntegerField()


class BookingRequestSerializer(serializers.ModelSerializer):
    member_name = serializers.CharField(source='member.name', read_only=True, default=None)
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default=None)
    berth_code  = serializers.CharField(source='berth.code',  read_only=True)
    booking_id  = serializers.PrimaryKeyRelatedField(source='booking', read_only=True)

    class Meta:
        model = BookingRequest
        fields = [
            'id', 'member', 'member_name', 'vessel', 'vessel_name',
            'guest_name', 'guest_phone', 'guest_email', 'guest_vessel', 'guest_loa',
            'berth', 'berth_code', 'booking_type', 'start_date', 'end_date', 'notes',
            'status', 'booking_id', 'created_at',
        ]
        read_only_fields = ['id', 'member_name', 'vessel_name', 'berth_code', 'booking_id', 'created_at']


class ReservationItemSerializer(serializers.ModelSerializer):
    berth_code  = serializers.CharField(source='berth.code',  read_only=True, default=None)
    vessel_name_resolved = serializers.CharField(source='vessel.name', read_only=True, default=None)

    class Meta:
        model = ReservationItem
        fields = [
            'id', 'berth', 'berth_code', 'vessel', 'vessel_name', 'vessel_name_resolved',
            'booking_type', 'check_in', 'check_out', 'nights', 'item_price',
            'boat_loa', 'boat_beam', 'boat_draft', 'eta',
            'is_sublet', 'is_hourly', 'start_time', 'end_time',
            'dynamic_price_applied', 'ota_commission_amount',
            'insurance_verified', 'registration_verified',
            'waiver_verified', 'document_gate_cleared',
            'pre_cleared', 'created_at',
        ]
        read_only_fields = ['id', 'berth_code', 'vessel_name_resolved', 'nights', 'created_at']


class ReservationSerializer(serializers.ModelSerializer):
    items = ReservationItemSerializer(many=True, read_only=True)
    member_name = serializers.CharField(source='member.name', read_only=True, default=None)

    class Meta:
        model = Reservation
        fields = [
            'id', 'marina', 'member', 'member_name',
            'guest_name', 'guest_email', 'guest_phone',
            'status', 'paid', 'total_price', 'stripe_payment_intent_id',
            'waiver_signed', 'self_checked_in', 'self_checked_in_at',
            'booking_source', 'notes', 'created_at',
            'items',
        ]
        read_only_fields = ['id', 'member_name', 'self_checked_in_at', 'created_at']

    def validate(self, data):
        """Billing-state gate (TD4) — see BookingSerializer.validate."""
        from apps.accounts.billing_gates import (
            ACTION_CREATE_RESERVATION,
            ACTION_MUTATE_BOOKING,
            assert_marina_can,
        )
        request = self.context.get('request')
        marina = getattr(getattr(request, 'user', None), 'marina', None)
        if marina is not None:
            action = ACTION_CREATE_RESERVATION if self.instance is None else ACTION_MUTATE_BOOKING
            assert_marina_can(marina, action)
        return data

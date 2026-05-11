from datetime import date
from decimal import Decimal

from django.db import models, transaction
from rest_framework import serializers

from apps.charter.models import (
    CharterAgentCommission,
    CharterAgreement,
    CharterBooking,
    CharterManagementAgreement,
    CharterVessel,
    CharterVesselOTAMapping,
    RentalBooking,
    RentalUnit,
)
from apps.charter.services import check_rental_availability


class CharterVesselSerializer(serializers.ModelSerializer):
    vessel_name = serializers.CharField(source='vessel.name', read_only=True)

    class Meta:
        model = CharterVessel
        fields = [
            'id', 'marina', 'vessel', 'vessel_name',
            'hourly_rate_item', 'daily_rate_item', 'weekly_rate_item',
            'cleaning_fee_item', 'skipper_fee_item',
            'fuel_inclusive', 'skipper_required', 'min_charterer_qual',
            'security_deposit', 'max_duration_days', 'is_available', 'notes',
            'created_at',
        ]
        read_only_fields = ['marina', 'created_at']

    def _validate_charter_category(self, value, field_name):
        if value is not None and value.category != 'charter':
            raise serializers.ValidationError(f"{field_name} must have category='charter'.")
        return value

    def validate_hourly_rate_item(self, value):
        return self._validate_charter_category(value, 'hourly_rate_item')

    def validate_daily_rate_item(self, value):
        return self._validate_charter_category(value, 'daily_rate_item')

    def validate_weekly_rate_item(self, value):
        return self._validate_charter_category(value, 'weekly_rate_item')

    def validate_cleaning_fee_item(self, value):
        return self._validate_charter_category(value, 'cleaning_fee_item')

    def validate_skipper_fee_item(self, value):
        return self._validate_charter_category(value, 'skipper_fee_item')

    def validate(self, data):
        vessel = data.get('vessel') or (self.instance.vessel if self.instance else None)
        if vessel:
            from apps.charter.models import RentalUnit as RU
            if RU.objects.filter(marina=vessel.marina if hasattr(vessel, 'marina') else None).exists():
                pass  # RentalUnit has no vessel FK — mutual exclusion not needed at DB level
        return data


class CharterManagementAgreementSerializer(serializers.ModelSerializer):
    charter_vessel_name = serializers.CharField(source='charter_vessel.vessel.name', read_only=True)
    member_name = serializers.CharField(source='member.name', read_only=True, default=None)

    class Meta:
        model = CharterManagementAgreement
        fields = [
            'id', 'marina', 'charter_vessel', 'charter_vessel_name',
            'member', 'member_name', 'owner_label',
            'split_percentage', 'commission_rate',
            'valid_from', 'valid_to', 'notes', 'created_at',
        ]
        read_only_fields = ['marina', 'created_at']

    def validate(self, data):
        charter_vessel = data.get('charter_vessel') or (self.instance.charter_vessel if self.instance else None)
        split_percentage = data.get('split_percentage', Decimal('0'))
        today = date.today()

        qs = CharterManagementAgreement.objects.filter(
            charter_vessel=charter_vessel,
        ).filter(
            models.Q(valid_to__isnull=True) | models.Q(valid_to__gte=today)
        )
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)

        existing_sum = sum(a.split_percentage for a in qs)
        total = existing_sum + split_percentage
        if total != Decimal('100.00'):
            raise serializers.ValidationError(
                f'Active agreements for this vessel must sum to exactly 100%. '
                f'Existing sum: {existing_sum}%, this record: {split_percentage}%, total: {total}%.'
            )
        return data


class CharterBookingSerializer(serializers.ModelSerializer):
    charter_vessel_name = serializers.CharField(source='charter_vessel.vessel.name', read_only=True)
    charterer_display = serializers.CharField(source='charterer.name', read_only=True, default=None)
    skipper_name = serializers.CharField(source='skipper.name', read_only=True, default=None)

    class Meta:
        model = CharterBooking
        fields = [
            'id', 'marina', 'charter_vessel', 'charter_vessel_name',
            'charterer', 'charterer_display', 'charterer_name', 'charterer_email', 'charterer_phone',
            'skipper', 'skipper_name',
            'start_dt', 'end_dt', 'duration_unit',
            'rate_applied', 'fuel_inclusive', 'cleaning_fee', 'skipper_fee',
            'deposit_amount', 'deposit_status', 'deposit_mechanism', 'deposit_stripe_payment_intent',
            'subtotal', 'total',
            'channel', 'channel_ref', 'channel_commission',
            'invoice', 'status', 'internal_notes', 'created_at',
        ]
        read_only_fields = ['marina', 'created_at', 'invoice']

    def validate(self, data):
        start_dt = data.get('start_dt') or (self.instance.start_dt if self.instance else None)
        end_dt = data.get('end_dt') or (self.instance.end_dt if self.instance else None)
        charter_vessel = data.get('charter_vessel') or (self.instance.charter_vessel if self.instance else None)
        skipper = data.get('skipper') or (self.instance.skipper if self.instance else None)
        new_status = data.get('status')

        if start_dt and end_dt and start_dt >= end_dt:
            raise serializers.ValidationError({'end_dt': 'end_dt must be after start_dt.'})

        # Overlap check for the vessel
        if charter_vessel and start_dt and end_dt:
            qs = CharterBooking.objects.filter(
                charter_vessel=charter_vessel,
                start_dt__lt=end_dt,
                end_dt__gt=start_dt,
            ).exclude(status='cancelled')
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    'This charter vessel is already booked for the selected time window.'
                )

        # Skipper required check on confirmation
        if charter_vessel and new_status == CharterBooking.Status.CONFIRMED:
            if charter_vessel.skipper_required and not skipper:
                raise serializers.ValidationError(
                    {'skipper': 'A skipper must be assigned before confirming a booking for this vessel.'}
                )

        return data

    def validate_skipper(self, skipper):
        if skipper is None:
            return skipper
        charter_vessel = (
            self.initial_data.get('charter_vessel')
            or (self.instance.charter_vessel if self.instance else None)
        )
        if charter_vessel and hasattr(charter_vessel, 'min_charterer_qual') and charter_vessel.min_charterer_qual:
            from apps.staff.models import Certification
            has_cert = Certification.objects.filter(
                staff_member=skipper,
                name=charter_vessel.min_charterer_qual,
                status='valid',
            ).exists()
            if not has_cert:
                raise serializers.ValidationError(
                    f"Skipper does not hold a valid '{charter_vessel.min_charterer_qual}' certification."
                )
        return skipper


class CharterAgreementSerializer(serializers.ModelSerializer):
    class Meta:
        model = CharterAgreement
        fields = ['id', 'marina', 'booking', 'envelope', 'signed_at', 'charterer_ip', 'created_at']
        read_only_fields = ['marina', 'created_at']


class CharterAgentCommissionSerializer(serializers.ModelSerializer):
    booking_status = serializers.CharField(source='booking.status', read_only=True)

    class Meta:
        model = CharterAgentCommission
        fields = [
            'id', 'marina', 'booking', 'booking_status',
            'agent_name', 'agent_email',
            'commission_rate', 'commission_amount',
            'payment_status', 'paid_at', 'notes', 'created_at',
        ]
        read_only_fields = ['marina', 'created_at']

    def validate(self, data):
        new_payment_status = data.get('payment_status')
        if new_payment_status == CharterAgentCommission.PaymentStatus.APPROVED:
            booking = data.get('booking') or (self.instance.booking if self.instance else None)
            if booking and booking.status != CharterBooking.Status.COMPLETED:
                raise serializers.ValidationError(
                    'Commission cannot be approved until the charter is completed.'
                )
        return data


class CharterVesselOTAMappingSerializer(serializers.ModelSerializer):
    class Meta:
        model = CharterVesselOTAMapping
        fields = ['id', 'marina', 'charter_vessel', 'channel', 'ota_vessel_id']
        read_only_fields = ['marina']


class RentalUnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = RentalUnit
        fields = [
            'id', 'marina', 'name', 'unit_type', 'colour',
            'hourly_rate_item', 'halfday_rate_item', 'fullday_rate_item',
            'turnaround_minutes', 'is_active', 'notes', 'created_at',
        ]
        read_only_fields = ['marina', 'created_at']

    def _validate_charter_category(self, value, field_name):
        if value is not None and value.category != 'charter':
            raise serializers.ValidationError(f"{field_name} must have category='charter'.")
        return value

    def validate_hourly_rate_item(self, value):
        return self._validate_charter_category(value, 'hourly_rate_item')

    def validate_halfday_rate_item(self, value):
        return self._validate_charter_category(value, 'halfday_rate_item')

    def validate_fullday_rate_item(self, value):
        return self._validate_charter_category(value, 'fullday_rate_item')


class RentalBookingSerializer(serializers.ModelSerializer):
    rental_unit_name = serializers.CharField(source='rental_unit.name', read_only=True)
    member_name = serializers.CharField(source='member.name', read_only=True, default=None)

    class Meta:
        model = RentalBooking
        fields = [
            'id', 'marina', 'rental_unit', 'rental_unit_name',
            'member', 'member_name', 'customer_name', 'customer_email', 'customer_phone',
            'start_dt', 'end_dt', 'duration_minutes',
            'rate_applied', 'total',
            'invoice', 'status', 'online_booking', 'stripe_payment_intent',
            'notes', 'created_at',
        ]
        read_only_fields = ['marina', 'created_at', 'invoice']

    def validate(self, data):
        rental_unit = data.get('rental_unit') or (self.instance.rental_unit if self.instance else None)
        start_dt = data.get('start_dt') or (self.instance.start_dt if self.instance else None)
        end_dt = data.get('end_dt') or (self.instance.end_dt if self.instance else None)

        if start_dt and end_dt and start_dt >= end_dt:
            raise serializers.ValidationError({'end_dt': 'end_dt must be after start_dt.'})

        if rental_unit and start_dt and end_dt:
            with transaction.atomic():
                available = check_rental_availability(rental_unit, start_dt, end_dt)
                if not available:
                    raise serializers.ValidationError(
                        'This rental unit is unavailable for the requested time window '
                        '(including turnaround buffer).'
                    )
        return data

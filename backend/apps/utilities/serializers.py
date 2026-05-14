"""
Utilities app serializers.

One serializer per model, with nested read helpers where useful.
WashTokenRedeemSerializer validates the token_code format (6-char alphanumeric).
"""

import re

from rest_framework import serializers

from apps.utilities.models import (
    BollardFaultLog,
    BollardSwitchEvent,
    MarinaMeterWebhookKey,
    MeterOutageAlert,
    MeterReading,
    ServiceBollard,
    SmartMeter,
    UtilityIntegration,
    UtilityWallet,
    UtilityWalletTransaction,
    WashToken,
)


# ---------------------------------------------------------------------------
# UtilityIntegration
# ---------------------------------------------------------------------------

class UtilityIntegrationSerializer(serializers.ModelSerializer):
    credentials = serializers.JSONField(write_only=True, required=False)

    class Meta:
        model  = UtilityIntegration
        fields = [
            'id', 'marina', 'vendor', 'credentials', 'is_active',
            'last_sync_at', 'last_sync_ok', 'last_sync_error',
        ]
        read_only_fields = ['marina', 'last_sync_at', 'last_sync_ok', 'last_sync_error']

    def validate_credentials(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError('credentials must be a JSON object.')
        if 'api_key' not in value or not value['api_key']:
            raise serializers.ValidationError('credentials.api_key is required.')
        return value


# ---------------------------------------------------------------------------
# SmartMeter
# ---------------------------------------------------------------------------

class SmartMeterSerializer(serializers.ModelSerializer):
    class Meta:
        model  = SmartMeter
        fields = [
            'id', 'marina', 'berth', 'vendor', 'meter_type',
            'device_id', 'label', 'poll_interval_minutes',
            'is_active', 'last_polled', 'is_online',
        ]
        read_only_fields = ['last_polled', 'is_online']


# ---------------------------------------------------------------------------
# MeterReading
# ---------------------------------------------------------------------------

class MeterReadingSerializer(serializers.ModelSerializer):
    class Meta:
        model  = MeterReading
        fields = [
            'id', 'meter', 'reading_kwh', 'reading_m3',
            'recorded_at', 'source',
        ]
        read_only_fields = ['meter']  # set from URL kwargs in the view


class MeterReadingCreateSerializer(serializers.ModelSerializer):
    """For manual entry — source is forced to 'manual'."""

    class Meta:
        model  = MeterReading
        fields = ['reading_kwh', 'reading_m3', 'recorded_at']

    def create(self, validated_data):
        validated_data['source'] = 'manual'
        return super().create(validated_data)


# ---------------------------------------------------------------------------
# MeterOutageAlert
# ---------------------------------------------------------------------------

class MeterOutageAlertSerializer(serializers.ModelSerializer):
    meter_label = serializers.CharField(source='meter.label', read_only=True)
    device_id   = serializers.CharField(source='meter.device_id', read_only=True)

    class Meta:
        model  = MeterOutageAlert
        fields = ['id', 'meter', 'meter_label', 'device_id', 'started_at', 'resolved_at', 'notified']
        read_only_fields = ['started_at']


# ---------------------------------------------------------------------------
# UtilityWallet
# ---------------------------------------------------------------------------

class UtilityWalletTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model  = UtilityWalletTransaction
        fields = [
            'id', 'tx_type', 'amount', 'balance_after',
            'description', 'stripe_payment_intent', 'invoice_line', 'created_at',
        ]
        read_only_fields = ['created_at', 'balance_after']


class UtilityWalletSerializer(serializers.ModelSerializer):
    transactions = UtilityWalletTransactionSerializer(many=True, read_only=True)

    class Meta:
        model  = UtilityWallet
        fields = [
            'id', 'marina', 'member', 'balance',
            'low_balance_threshold', 'auto_deduct_enabled',
            'last_low_balance_alert', 'transactions',
        ]
        read_only_fields = ['balance', 'last_low_balance_alert']


class WalletTopUpSerializer(serializers.Serializer):
    amount      = serializers.DecimalField(max_digits=10, decimal_places=2, min_value='0.01')
    description = serializers.CharField(max_length=300, required=False, default='Staff top-up')


class StripeTopUpSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value='0.50')


# ---------------------------------------------------------------------------
# ServiceBollard
# ---------------------------------------------------------------------------

class ServiceBollardSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ServiceBollard
        fields = [
            'id', 'marina', 'berth', 'label', 'max_amps', 'voltage',
            'has_remote_switch', 'vendor', 'vendor_device_id',
            'status', 'smart_meter', 'notes',
        ]


class BollardSwitchSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=['on', 'off'])
    reason = serializers.CharField(max_length=300, required=False, default='')


# ---------------------------------------------------------------------------
# BollardFaultLog
# ---------------------------------------------------------------------------

class BollardFaultLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = BollardFaultLog
        fields = [
            'id', 'bollard', 'fault_type', 'description',
            'reported_at', 'resolved_at', 'work_order',
        ]
        read_only_fields = ['reported_at', 'work_order']


# ---------------------------------------------------------------------------
# BollardSwitchEvent
# ---------------------------------------------------------------------------

class BollardSwitchEventSerializer(serializers.ModelSerializer):
    class Meta:
        model  = BollardSwitchEvent
        fields = [
            'id', 'bollard', 'action', 'triggered_by',
            'reason', 'success', 'vendor_response', 'created_at',
        ]
        read_only_fields = ['created_at', 'success', 'vendor_response']


# ---------------------------------------------------------------------------
# WashToken
# ---------------------------------------------------------------------------

class WashTokenSerializer(serializers.ModelSerializer):
    class Meta:
        model  = WashToken
        fields = [
            'id', 'marina', 'member', 'facility', 'token_code',
            'status', 'expires_at', 'issued_at', 'redeemed_at',
            'invoice_line', 'chargeable_item',
        ]
        read_only_fields = ['token_code', 'issued_at', 'redeemed_at', 'status']


class WashTokenRedeemSerializer(serializers.Serializer):
    token_code = serializers.CharField(
        min_length=4,
        max_length=20,
        help_text='Alphanumeric token PIN issued at point of sale.',
    )

    def validate_token_code(self, value):
        if not re.match(r'^[A-Z0-9]{4,20}$', value.upper()):
            raise serializers.ValidationError(
                'token_code must be 4–20 uppercase alphanumeric characters.'
            )
        return value.upper()


# ---------------------------------------------------------------------------
# Dockwalk — meter list for staff pier-walk
# ---------------------------------------------------------------------------

class DockwalkMeterSerializer(serializers.ModelSerializer):
    berth_code       = serializers.CharField(source='berth.code', read_only=True, default=None)
    pier_label       = serializers.CharField(source='berth.pier.label', read_only=True, default=None)
    last_reading_kwh = serializers.SerializerMethodField()
    last_reading_m3  = serializers.SerializerMethodField()
    last_recorded_at = serializers.SerializerMethodField()

    class Meta:
        model  = SmartMeter
        fields = [
            'id', 'device_id', 'label', 'meter_type', 'vendor',
            'berth_code', 'pier_label',
            'last_reading_kwh', 'last_reading_m3', 'last_recorded_at',
        ]

    def _last(self, meter):
        return meter.readings.order_by('-recorded_at').first()

    def get_last_reading_kwh(self, meter):
        r = self._last(meter)
        return str(r.reading_kwh) if r and r.reading_kwh is not None else None

    def get_last_reading_m3(self, meter):
        r = self._last(meter)
        return str(r.reading_m3) if r and r.reading_m3 is not None else None

    def get_last_recorded_at(self, meter):
        r = self._last(meter)
        return r.recorded_at if r else None


# ---------------------------------------------------------------------------
# MarinaMeterWebhookKey
# ---------------------------------------------------------------------------

class MarinaMeterWebhookKeySerializer(serializers.ModelSerializer):
    """
    Read-only public view of the key. The plaintext is NEVER serialized here —
    it is only returned by the rotate view, as a sibling top-level field.
    """
    endpoint_url = serializers.SerializerMethodField()
    status       = serializers.SerializerMethodField()

    class Meta:
        model  = MarinaMeterWebhookKey
        fields = ['key_prefix', 'is_active', 'created_at', 'rotated_at',
                  'last_used_at', 'endpoint_url', 'status']
        read_only_fields = fields

    def get_endpoint_url(self, obj):
        request = self.context.get('request')
        if request is None:
            return '/api/v1/utilities/webhook/readings/'
        return request.build_absolute_uri('/api/v1/utilities/webhook/readings/')

    def get_status(self, obj):
        if not obj.key_hash:
            return 'unissued'
        return 'active' if obj.is_active else 'revoked'


# ---------------------------------------------------------------------------
# Ingest envelope (webhook payload)
# ---------------------------------------------------------------------------

class ReadingIngestItemSerializer(serializers.Serializer):
    device_id      = serializers.CharField(required=False, allow_blank=True)
    recorded_at    = serializers.DateTimeField()
    cumulative_kwh = serializers.DecimalField(max_digits=12, decimal_places=3,
                                              required=False, allow_null=True)
    cumulative_m3  = serializers.DecimalField(max_digits=12, decimal_places=3,
                                              required=False, allow_null=True)

    def validate(self, attrs):
        if attrs.get('cumulative_kwh') is None and attrs.get('cumulative_m3') is None:
            raise serializers.ValidationError('At least one of cumulative_kwh / cumulative_m3 is required.')
        return attrs


class ReadingIngestSerializer(serializers.Serializer):
    readings = ReadingIngestItemSerializer(many=True)

    def validate_readings(self, value):
        if not value:
            raise serializers.ValidationError('readings[] must contain at least one entry.')
        if len(value) > 5000:
            raise serializers.ValidationError('Maximum 5000 readings per request.')
        return value

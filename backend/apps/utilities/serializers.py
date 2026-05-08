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
    class Meta:
        model  = UtilityIntegration
        fields = [
            'id', 'marina', 'vendor', 'is_active',
            'last_sync_at', 'last_sync_ok', 'last_sync_error',
        ]
        read_only_fields = ['last_sync_at', 'last_sync_ok', 'last_sync_error']
        # credentials intentionally excluded from API responses


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

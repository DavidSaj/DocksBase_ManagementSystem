from decimal import Decimal
from django.utils import timezone
from rest_framework import serializers

from apps.revenue.models import BookingTier, WaitlistEntry, YieldApplication, YieldRule


class BookingTierSerializer(serializers.ModelSerializer):
    berth_category_name = serializers.CharField(source='berth_category.name', read_only=True)

    class Meta:
        model = BookingTier
        fields = [
            'id', 'berth_category', 'berth_category_name',
            'season', 'booking_type', 'base_nightly_rate', 'min_stay_nights',
        ]


class YieldRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = YieldRule
        fields = [
            'id', 'name', 'rule_type', 'parameters',
            'multiplier', 'priority', 'is_active', 'created_at',
        ]
        read_only_fields = ['created_at']


class YieldApplicationSerializer(serializers.ModelSerializer):
    rule_name = serializers.CharField(source='rule.name', read_only=True, default=None)
    discount_pct = serializers.DecimalField(max_digits=6, decimal_places=2, read_only=True)

    class Meta:
        model = YieldApplication
        fields = [
            'id', 'booking', 'rule', 'rule_name',
            'base_price', 'applied_price', 'discount_pct', 'applied_at',
        ]
        read_only_fields = ['applied_at']


class WaitlistEntrySerializer(serializers.ModelSerializer):
    member_name = serializers.CharField(source='member.name', read_only=True)

    class Meta:
        model = WaitlistEntry
        fields = [
            'id', 'member', 'member_name', 'vessel',
            'desired_from', 'desired_to', 'booking_type',
            'vessel_loa', 'vessel_beam', 'vessel_draft',
            'notes', 'priority_score', 'is_active', 'fulfilled_booking', 'created_at',
        ]
        read_only_fields = ['priority_score', 'fulfilled_booking', 'created_at']


class PriceCalculatorSerializer(serializers.Serializer):
    berth = serializers.IntegerField()
    check_in = serializers.DateField()
    check_out = serializers.DateField()
    booking_type = serializers.ChoiceField(choices=['transient', 'seasonal'], default='transient')

    def validate(self, data):
        if data['check_out'] <= data['check_in']:
            raise serializers.ValidationError('check_out must be after check_in.')
        return data

    def calculate(self, marina):
        from apps.berths.models import Berth
        from apps.revenue.engine import calculate_booking_price

        try:
            berth = Berth.objects.get(pk=self.validated_data['berth'], marina=marina)
        except Berth.DoesNotExist:
            raise serializers.ValidationError({'berth': 'Berth not found.'})

        base, applied, rule = calculate_booking_price(
            marina=marina,
            berth=berth,
            check_in=self.validated_data['check_in'],
            check_out=self.validated_data['check_out'],
            booking_type=self.validated_data['booking_type'],
        )
        nights = (self.validated_data['check_out'] - self.validated_data['check_in']).days

        return {
            'berth': berth.pk,
            'check_in': self.validated_data['check_in'],
            'check_out': self.validated_data['check_out'],
            'nights': nights,
            'base_price': base,
            'applied_price': applied,
            'applied_rule': rule.name if rule else None,
            'applied_rule_id': rule.pk if rule else None,
            'multiplier': rule.multiplier if rule else Decimal('1.0'),
        }

from rest_framework import serializers
from .models import Pier, Berth, MarinaMapConfig, Amenity, OTAConnection, BerthCategory, LogicalPier, AMENITY_SLUGS
from apps.billing.models import ChargeableItem


class OTAConnectionSerializer(serializers.ModelSerializer):
    berth_count = serializers.SerializerMethodField()

    class Meta:
        model = OTAConnection
        fields = ['id', 'name', 'slug', 'inbound_ical_url', 'outbound_token',
                  'target_pct', 'auto_allocate', 'last_synced', 'berth_count']
        read_only_fields = ['id', 'slug', 'outbound_token', 'last_synced', 'berth_count']

    def get_berth_count(self, obj):
        from .models import Berth
        return Berth.objects.filter(ota_connection=obj).exclude(status='maintenance').count()

    def validate_name(self, value):
        from django.utils.text import slugify
        marina = self.context['request'].user.marina
        slug = slugify(value)
        qs = OTAConnection.objects.filter(marina=marina, slug=slug)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('An OTA connection with this name already exists.')
        return value

    def create(self, validated_data):
        from django.utils.text import slugify
        validated_data['slug'] = slugify(validated_data['name'])
        validated_data['marina'] = self.context['request'].user.marina
        return super().create(validated_data)

    def update(self, instance, validated_data):
        from django.utils.text import slugify
        if 'name' in validated_data:
            validated_data['slug'] = slugify(validated_data['name'])
        return super().update(instance, validated_data)


_GHOST_SLOT_KEYS = {'x', 'y', 'rotation', 'width_m', 'height_m'}


class LogicalPierSerializer(serializers.ModelSerializer):
    dock_shapes_count = serializers.SerializerMethodField()
    berths_count      = serializers.SerializerMethodField()

    class Meta:
        model  = LogicalPier
        fields = ['id', 'name', 'pier_type', 'notes', 'dock_shapes_count', 'berths_count']
        read_only_fields = ['id', 'dock_shapes_count', 'berths_count']

    def get_dock_shapes_count(self, obj):
        return obj.dock_shapes.count()

    def get_berths_count(self, obj):
        return Berth.objects.filter(pier__logical_pier=obj).count()


class PierSerializer(serializers.ModelSerializer):
    logical_pier_name = serializers.CharField(source='logical_pier.name', read_only=True, default=None)

    class Meta:
        model = Pier
        fields = [
            'id', 'code', 'label', 'display_name', 'polygon_points', 'pier_type', 'ghost_slots',
            'canvas_x', 'canvas_y', 'canvas_w', 'canvas_h', 'rotation',
            'logical_pier', 'logical_pier_name', 'components',
        ]
        read_only_fields = ['id', 'logical_pier_name']

    def validate_ghost_slots(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('ghost_slots must be a list.')
        for slot in value:
            if not isinstance(slot, dict):
                raise serializers.ValidationError('Each ghost slot must be an object.')
            missing = _GHOST_SLOT_KEYS - slot.keys()
            if missing:
                raise serializers.ValidationError(f'Ghost slot missing keys: {missing}.')
            for key in _GHOST_SLOT_KEYS:
                if not isinstance(slot[key], (int, float)):
                    raise serializers.ValidationError(f'Ghost slot field "{key}" must be numeric.')
        return value

    def validate_components(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('components must be a list.')
        for comp in value:
            if not isinstance(comp, dict):
                raise serializers.ValidationError('Each component must be an object.')
            required = {'id', 'type', 'ox', 'oy', 'w', 'h'}
            missing = required - comp.keys()
            if missing:
                raise serializers.ValidationError(f'Component missing keys: {missing}.')
            for key in ('ox', 'oy', 'w', 'h'):
                if not isinstance(comp[key], (int, float)):
                    raise serializers.ValidationError(f'Component field "{key}" must be numeric.')
        return value


_ACTIVE_BOOKING_STATUSES = frozenset([
    'confirmed', 'pending', 'awaiting_payment', 'pending_payment',
    'checked_in', 'overstay',
])
_OCCUPIED_STATUSES = frozenset(['checked_in', 'overstay'])


class BerthSerializer(serializers.ModelSerializer):
    pier_code                = serializers.CharField(source='pier.code',              read_only=True, default=None)
    pier_name                = serializers.CharField(source='pier.display_name',      read_only=True, default=None)
    vessel_name              = serializers.CharField(source='vessel.name',            read_only=True, default=None)
    pricing_tier_name        = serializers.CharField(source='pricing_tier.name',      read_only=True, default=None)
    pricing_tier_unit_price  = serializers.DecimalField(
        source='pricing_tier.unit_price',
        max_digits=10,
        decimal_places=2,
        read_only=True,
        allow_null=True,
    )
    # Track 1 — booking tier (yield / revenue intelligence tier)
    booking_tier_name = serializers.CharField(
        source='booking_tier.name', read_only=True, default=None, allow_null=True
    )
    is_placed          = serializers.SerializerMethodField()
    effective_status   = serializers.SerializerMethodField()
    pricing_tier = serializers.PrimaryKeyRelatedField(
        queryset=ChargeableItem.objects.filter(category='berth'),
        allow_null=True,
        required=False,
    )

    class Meta:
        model = Berth
        fields = [
            'id', 'code', 'berth_type', 'berth_class', 'operational_type',
            'pier', 'pier_code', 'pier_name', 'side', 'position_index',
            'length_m', 'max_draft_m', 'max_beam_m', 'amenities',
            'pricing_tier', 'pricing_tier_name', 'pricing_tier_unit_price',
            'booking_tier', 'booking_tier_name',
            'status', 'effective_status', 'vessel', 'vessel_name',
            'local_x', 'local_y', 'position_on_parent', 'is_placed',
            'ota_connection', 'channel_locked', 'category',
        ]
        read_only_fields = [
            'id', 'pier_code', 'pier_name', 'vessel_name', 'is_placed', 'effective_status',
            'booking_tier_name',
        ]

    def get_is_placed(self, obj):
        return obj.pier_id is not None and obj.local_x is not None and obj.local_y is not None

    def get_effective_status(self, obj):
        if obj.status == 'maintenance':
            return 'maintenance'
        # obj.bookings.all() uses the prefetch_related cache — no extra query
        active = [b for b in obj.bookings.all() if b.status in _ACTIVE_BOOKING_STATUSES]
        if not active:
            return obj.status
        if any(b.status in _OCCUPIED_STATUSES for b in active):
            return 'occupied'
        return 'reserved'

    def validate_pricing_tier(self, value):
        if value and value.category != 'berth':
            raise serializers.ValidationError("pricing_tier must be a Berth Rate item.")
        return value


class AmenitySerializer(serializers.ModelSerializer):
    type = serializers.ChoiceField(choices=[t[0] for t in Amenity.AMENITY_TYPES])

    class Meta:
        model = Amenity
        fields = ['id', 'type', 'label', 'canvas_x', 'canvas_y', 'scale', 'rotation']
        read_only_fields = ['id']


class MarinaMapConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = MarinaMapConfig
        fields = ['config', 'updated_at']
        read_only_fields = ['updated_at']


class BerthCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = BerthCategory
        fields = ['id', 'name', 'description', 'mooring_type', 'amenities',
                  'pricing_tier', 'sort_order', 'is_active']

    def validate_amenities(self, value):
        bad = [s for s in value if s not in AMENITY_SLUGS]
        if bad:
            raise serializers.ValidationError(
                f'Unknown amenity slug(s): {bad}. Allowed: {sorted(AMENITY_SLUGS)}'
            )
        return value


# ── Track 2 — Berth Intelligence serializers ───────────────────────────────────

from .models import (
    BerthScoreWeights, TemporaryDeparture, SubLetBooking,
    FleetAssignJob, DockWalkSession, DockWalkEntry,
    BerthAlert, BerthListing, BerthListingEnquiry,
)


class BerthScoreWeightsSerializer(serializers.ModelSerializer):
    class Meta:
        model = BerthScoreWeights
        fields = ['w_size_fit', 'w_gap_min', 'w_amenity_match', 'w_pier_cluster', 'updated_at']
        read_only_fields = ['updated_at']

    def validate(self, attrs):
        # Merge with existing instance values for partial updates
        instance = self.instance
        w_size_fit      = attrs.get('w_size_fit',      instance.w_size_fit      if instance else 40)
        w_gap_min       = attrs.get('w_gap_min',       instance.w_gap_min       if instance else 25)
        w_amenity_match = attrs.get('w_amenity_match', instance.w_amenity_match if instance else 20)
        w_pier_cluster  = attrs.get('w_pier_cluster',  instance.w_pier_cluster  if instance else 15)
        total = w_size_fit + w_gap_min + w_amenity_match + w_pier_cluster
        if total != 100:
            raise serializers.ValidationError(
                f'Score weights must sum to 100 (got {total}).'
            )
        return attrs


class SubLetBookingSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = SubLetBooking
        fields = [
            'id', 'booking', 'total_revenue', 'holder_share', 'marina_share',
            'inventory_collision', 'actual_nights_sublet', 'credit_applied_at',
        ]
        read_only_fields = fields


class TemporaryDepartureSerializer(serializers.ModelSerializer):
    berth_code   = serializers.CharField(source='berth.code', read_only=True)
    vessel_name  = serializers.CharField(source='vessel.name', read_only=True)
    member_name  = serializers.CharField(source='member.name', read_only=True, default=None)
    sublet_bookings = SubLetBookingSummarySerializer(many=True, read_only=True)

    class Meta:
        model = TemporaryDeparture
        fields = [
            'id', 'marina', 'berth', 'berth_code', 'vessel', 'vessel_name',
            'member', 'member_name',
            'depart_date', 'expected_return', 'actual_return', 'status',
            'sublet_enabled', 'revenue_share_pct',
            'departure_heading', 'notes',
            'created_by', 'created_at',
            'sublet_bookings',
        ]
        read_only_fields = ['id', 'marina', 'created_at', 'berth_code', 'vessel_name', 'member_name']


class SubLetBookingSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubLetBooking
        fields = [
            'id', 'marina', 'departure', 'booking',
            'total_revenue', 'holder_share', 'marina_share',
            'credit_invoice_id', 'credit_applied_at',
            'inventory_collision', 'actual_nights_sublet',
            'relocation_booking', 'created_at',
        ]
        read_only_fields = fields


class FleetAssignJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = FleetAssignJob
        fields = [
            'id', 'marina', 'status', 'request_payload', 'result_payload',
            'celery_task_id', 'error_detail', 'created_by', 'created_at', 'completed_at',
        ]
        read_only_fields = fields


class DockWalkSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = DockWalkSession
        fields = ['id', 'marina', 'pier', 'walked_by', 'started_at', 'finished_at', 'berth_order']
        read_only_fields = ['id', 'marina', 'berth_order']


class DockWalkEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = DockWalkEntry
        fields = [
            'id', 'marina', 'session', 'berth',
            'observed_occupancy', 'discrepancy',
            'electric_reading_kwh', 'water_reading_litres',
            'notes', 'photo', 'observed_at', 'synced_at', 'alert',
        ]
        read_only_fields = ['id', 'marina', 'synced_at', 'discrepancy', 'alert']


class BerthAlertSerializer(serializers.ModelSerializer):
    vessel_name        = serializers.CharField(source='vessel.name', read_only=True, default=None)
    vessel_owner_name  = serializers.SerializerMethodField()
    vessel_owner_phone = serializers.SerializerMethodField()
    departure_id       = serializers.IntegerField(source='departure.id', read_only=True, default=None)
    departure_heading  = serializers.CharField(source='departure.departure_heading', read_only=True, default='')
    expected_return    = serializers.DateField(source='departure.expected_return', read_only=True, default=None)
    hours_overdue      = serializers.SerializerMethodField()

    class Meta:
        model = BerthAlert
        fields = [
            'id', 'marina', 'alert_type', 'status',
            'berth', 'vessel', 'vessel_name',
            'vessel_owner_name', 'vessel_owner_phone',
            'departure', 'departure_id', 'departure_heading', 'expected_return',
            'detail', 'hours_overdue',
            'resolved_at', 'resolved_by',
            'coastguard_report_text', 'coastguard_escalated_at', 'coastguard_escalated_by',
            'created_at',
        ]
        read_only_fields = fields

    def get_vessel_owner_name(self, obj):
        if obj.departure and obj.departure.member:
            return obj.departure.member.name
        if obj.vessel and hasattr(obj.vessel, 'owner') and obj.vessel.owner:
            return obj.vessel.owner.name
        return None

    def get_vessel_owner_phone(self, obj):
        if obj.departure and obj.departure.member:
            return obj.departure.member.phone
        if obj.vessel and hasattr(obj.vessel, 'owner') and obj.vessel.owner:
            return obj.vessel.owner.phone
        return None

    def get_hours_overdue(self, obj):
        if not obj.departure:
            return None
        import datetime
        from django.utils import timezone
        expected_dt = datetime.datetime.combine(
            obj.departure.expected_return, datetime.time.min,
            tzinfo=timezone.utc,
        )
        delta = timezone.now() - expected_dt
        hours = delta.total_seconds() / 3600
        return round(hours, 1) if hours > 0 else 0.0


class BerthListingEnquirySerializer(serializers.ModelSerializer):
    class Meta:
        model = BerthListingEnquiry
        fields = [
            'id', 'marina', 'listing',
            'enquirer_member', 'enquirer_name', 'enquirer_email', 'enquirer_phone',
            'message', 'created_at',
        ]
        read_only_fields = ['id', 'marina', 'created_at']


class BerthListingSerializer(serializers.ModelSerializer):
    berth_code       = serializers.CharField(source='berth.code', read_only=True)
    berth_length_m   = serializers.DecimalField(
        source='berth.length_m', max_digits=6, decimal_places=1, read_only=True, allow_null=True,
    )
    berth_max_beam_m = serializers.DecimalField(
        source='berth.max_beam_m', max_digits=5, decimal_places=2, read_only=True, allow_null=True,
    )
    berth_amenities  = serializers.ListField(source='berth.amenities', read_only=True)
    seller_name      = serializers.CharField(source='seller_member.name', read_only=True, default=None)
    commission_pct   = serializers.SerializerMethodField()
    enquiry_count    = serializers.SerializerMethodField()

    class Meta:
        model = BerthListing
        fields = [
            'id', 'marina', 'berth', 'berth_code', 'berth_length_m', 'berth_max_beam_m', 'berth_amenities',
            'seller_member', 'seller_name',
            'asking_price', 'licence_terms', 'description', 'status',
            'commission_pct', 'enquiry_count',
            'listed_at', 'updated_at',
        ]
        read_only_fields = ['id', 'marina', 'listed_at', 'updated_at']

    def get_commission_pct(self, obj):
        return float(obj.marina.berth_sale_commission_pct)

    def get_enquiry_count(self, obj):
        return obj.enquiries.count()

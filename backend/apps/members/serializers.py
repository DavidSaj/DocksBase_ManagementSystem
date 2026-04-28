from rest_framework import serializers
from .models import Member, Segment, ALLOWED_SEGMENT_FILTER_KEYS


class MemberSerializer(serializers.ModelSerializer):
    vessels = serializers.SerializerMethodField()

    class Meta:
        model = Member
        fields = [
            'id', 'name', 'email', 'phone', 'member_type',
            'insurance_status', 'docs_status', 'joined_at', 'tags',
            'preferred_name', 'nationality', 'address', 'address_country',
            'emergency_name', 'emergency_relationship', 'emergency_phone',
            'vessels',
        ]
        read_only_fields = ['id']

    def get_vessels(self, obj):
        return [{'id': v.id, 'name': v.name, 'reg': v.reg} for v in obj.vessels.all()]


class SegmentSerializer(serializers.ModelSerializer):
    count = serializers.SerializerMethodField()

    class Meta:
        model = Segment
        fields = ['id', 'name', 'description', 'filter_params', 'count']
        read_only_fields = ['id']

    def get_count(self, obj):
        return Member.objects.filter(marina=obj.marina, **obj.filter_params).count()

    def validate_filter_params(self, value):
        invalid = set(value.keys()) - ALLOWED_SEGMENT_FILTER_KEYS
        if invalid:
            raise serializers.ValidationError(
                f"Invalid filter key(s): {', '.join(sorted(invalid))}. "
                f"Allowed keys: {', '.join(sorted(ALLOWED_SEGMENT_FILTER_KEYS))}."
            )
        return value

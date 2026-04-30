from rest_framework import serializers
from .models import Certification, Shift, StaffMember


class StaffMemberSerializer(serializers.ModelSerializer):
    initials = serializers.SerializerMethodField()

    class Meta:
        model = StaffMember
        fields = ['id', 'name', 'initials', 'role', 'department', 'email', 'phone',
                  'contract', 'start_date', 'is_active']

    def get_initials(self, obj):
        if obj.initials:
            return obj.initials
        words = obj.name.split()
        return ''.join(w[0].upper() for w in words if w)[:3]


class ShiftSerializer(serializers.ModelSerializer):
    staff_member_name = serializers.CharField(source='staff_member.name', read_only=True)
    start_time = serializers.TimeField(allow_null=True, required=False)
    end_time = serializers.TimeField(allow_null=True, required=False)

    class Meta:
        model = Shift
        fields = ['id', 'staff_member', 'staff_member_name', 'week_start', 'day',
                  'start_time', 'end_time', 'department', 'is_off']

    def validate(self, data):
        is_off = data.get('is_off', getattr(self.instance, 'is_off', False))
        if not is_off:
            start = data.get('start_time', getattr(self.instance, 'start_time', None))
            end = data.get('end_time', getattr(self.instance, 'end_time', None))
            if not start or not end:
                raise serializers.ValidationError('start_time and end_time are required when is_off is False.')
        return data


class CertificationSerializer(serializers.ModelSerializer):
    staff_member_name = serializers.CharField(source='staff_member.name', read_only=True)
    status = serializers.CharField(read_only=True)

    class Meta:
        model = Certification
        fields = ['id', 'staff_member', 'staff_member_name', 'name', 'issuing_body',
                  'issued', 'expires', 'status', 'pdf_file']

    def to_representation(self, instance):
        rep = super().to_representation(instance)
        request = self.context.get('request')
        if instance.pdf_file and request:
            rep['pdf_file'] = request.build_absolute_uri(instance.pdf_file.url)
        else:
            rep['pdf_file'] = None
        return rep

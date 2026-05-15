from rest_framework import serializers

from apps.security.models import MarinaIPAllowlist


class MFAStatusSerializer(serializers.Serializer):
    enrolled = serializers.BooleanField()
    enrolled_at = serializers.DateTimeField(allow_null=True)
    has_backup_codes = serializers.BooleanField()
    backup_codes_remaining = serializers.IntegerField()


class MFAEnrollStartSerializer(serializers.Serializer):
    secret = serializers.CharField()
    qr_uri = serializers.CharField()


class MFAEnrollCompleteSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=10)


class MFADisableSerializer(serializers.Serializer):
    password = serializers.CharField()


class MFALoginVerifySerializer(serializers.Serializer):
    mfa_challenge_token = serializers.CharField()
    code = serializers.CharField(max_length=20)
    trust_device = serializers.BooleanField(default=False, required=False)


class MFALoginEnrollCompleteSerializer(serializers.Serializer):
    mfa_enrollment_token = serializers.CharField()
    code = serializers.CharField(max_length=10)


# ---------------------------------------------------------------------------
# Task 2: IP Allowlist
# ---------------------------------------------------------------------------

class MarinaIPAllowlistSerializer(serializers.ModelSerializer):
    created_by_email = serializers.SerializerMethodField()

    class Meta:
        model = MarinaIPAllowlist
        fields = ['id', 'cidr', 'label', 'created_at', 'created_by_email']
        read_only_fields = ['id', 'created_at', 'created_by_email']

    def get_created_by_email(self, obj):
        if obj.created_by:
            return obj.created_by.email
        return None

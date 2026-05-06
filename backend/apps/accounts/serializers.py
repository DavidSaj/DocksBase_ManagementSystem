from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.exceptions import AuthenticationFailed
from .models import Marina, User
from config.plans import PLAN_PRICE_IDS, PRICE_ID_TO_PLAN


class MarinaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Marina
        # FIX 4: explicit fields instead of __all__ — sensitive/admin-only fields are read-only
        fields = [
            # read-writable by the owner
            'name', 'address', 'lat', 'lng', 'timezone', 'contact_email', 'phone',
            'currency', 'vat_rate', 'vat_number', 'payment_terms', 'booking_mode',
            'total_berths', 'dry_storage_slots', 'max_loa', 'max_draft', 'fuel_berths',
            # channel management
            'auto_allocate_inventory', 'mysea_target_pct', 'mysea_ical_url', 'mysea_last_synced',
            # read-only: owner can see but not change
            'id', 'status', 'plan', 'trial_ends', 'next_renewal', 'suspend_reason',
            'stripe_account_id', 'mrr_override', 'max_staff', 'features', 'onboarding',
            'created_at',
        ]
        read_only_fields = [
            'id', 'status', 'plan', 'trial_ends', 'next_renewal', 'suspend_reason',
            'stripe_account_id', 'mrr_override', 'max_staff', 'onboarding',
            'created_at', 'mysea_last_synced',
        ]


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'email', 'first_name', 'last_name', 'role', 'is_active', 'is_platform_admin', 'platform_role', 'module_permissions', 'created_at']
        read_only_fields = ['id', 'role', 'is_platform_admin', 'platform_role', 'is_active', 'created_at']


class UserInviteSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        # FIX 5: removed password field (invite flow no longer sets a plaintext password);
        # is_platform_admin is intentionally absent
        fields = ['email', 'first_name', 'last_name', 'role']

    # FIX 5: validate that only safe roles can be assigned via invite
    def validate_role(self, value):
        allowed = {'staff', 'manager'}
        if value not in allowed:
            raise serializers.ValidationError(f"Role must be one of: {', '.join(sorted(allowed))}")
        return value

    def create(self, validated_data):
        marina = self.context['request'].user.marina
        # FIX 8: create invited user as inactive; no password set here
        return User.objects.create_user(
            marina=marina,
            is_active=False,
            **validated_data,
        )


class DocksBaseTokenSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token['is_platform_admin'] = user.is_platform_admin
        token['role'] = user.role
        return token

    def validate(self, attrs):
        email = attrs.get('email', '')
        try:
            user = User.objects.get(email=email)
            if not user.is_active:
                raise AuthenticationFailed({
                    'code': 'email_not_verified',
                    'detail': 'Please verify your email before logging in.',
                })
        except User.DoesNotExist:
            pass
        data = super().validate(attrs)
        data['user'] = UserSerializer(self.user).data
        return data


class SendMagicLinkSerializer(serializers.Serializer):
    member_id = serializers.IntegerField(min_value=1)


class ExchangeMagicTokenSerializer(serializers.Serializer):
    token = serializers.UUIDField()


class SignupSerializer(serializers.Serializer):
    first_name  = serializers.CharField(max_length=100)
    last_name   = serializers.CharField(max_length=100)
    email       = serializers.EmailField()
    password    = serializers.CharField(min_length=8, write_only=True)
    marina_name = serializers.CharField(max_length=200)

    def validate_email(self, value):
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError(['A user with this email already exists.'])
        return value


class DraftAccountSerializer(serializers.Serializer):
    plan_price_id  = serializers.CharField()
    marina_name    = serializers.CharField(max_length=200)
    address        = serializers.CharField()
    lat            = serializers.DecimalField(max_digits=9, decimal_places=6, required=False, allow_null=True)
    lng            = serializers.DecimalField(max_digits=9, decimal_places=6, required=False, allow_null=True)
    phone          = serializers.CharField(max_length=30)
    contact_email  = serializers.EmailField()
    vat_number     = serializers.CharField(max_length=50, required=False, allow_blank=True)
    currency       = serializers.ChoiceField(choices=['EUR', 'GBP', 'USD', 'DKK', 'SEK', 'NOK'])
    first_name     = serializers.CharField(max_length=150)
    last_name      = serializers.CharField(max_length=150)
    email          = serializers.EmailField()
    password       = serializers.CharField(min_length=8, write_only=True)

    def validate_plan_price_id(self, value):
        if value not in PLAN_PRICE_IDS.values():
            raise serializers.ValidationError('Invalid plan.')
        return value

    def validate_email(self, value):
        user = User.objects.filter(email=value).select_related('marina').first()
        if user and user.marina and user.marina.status in ('trial', 'active'):
            raise serializers.ValidationError(
                'An account with this email already exists. Please log in.'
            )
        return value

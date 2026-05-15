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
            'basin_polygon', 'ais_poll_radius_nm',
            'operations_paused',
            # email / SMTP config
            'notification_from_email', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_password', 'smtp_use_tls',
            # read-only: owner can see but not change
            'id', 'slug', 'status', 'plan', 'trial_ends', 'next_renewal', 'suspend_reason',
            'stripe_account_id', 'mrr_override', 'max_staff', 'features', 'onboarding',
            'support_access_granted_until',
            'created_at',
        ]
        read_only_fields = [
            'id', 'slug', 'status', 'plan', 'trial_ends', 'next_renewal', 'suspend_reason',
            'stripe_account_id', 'mrr_override', 'max_staff', 'onboarding',
            'support_access_granted_until',
            'created_at',
        ]

    def validate_basin_polygon(self, value):
        if not value:
            return []
        if not isinstance(value, list) or len(value) < 3:
            raise serializers.ValidationError('Polygon must have at least 3 vertices.')
        for v in value:
            if not isinstance(v, (list, tuple)) or len(v) != 2:
                raise serializers.ValidationError('Each vertex must be [lat, lng].')
            try:
                lat, lng = float(v[0]), float(v[1])
            except (TypeError, ValueError):
                raise serializers.ValidationError('Vertex coordinates must be numeric.')
            if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
                raise serializers.ValidationError('Vertex coordinates out of range.')
        return value


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
        password = attrs.get('password', '')
        try:
            user = User.objects.get(email=email)
            if not user.is_active and user.check_password(password):
                raise AuthenticationFailed({
                    'code': 'email_not_verified',
                    'detail': 'Please verify your email. Use the resend link if you need a new verification email.',
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
    marina_count   = serializers.IntegerField(min_value=1, max_value=20, default=1)
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

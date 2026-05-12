from rest_framework import serializers
from apps.accounts.models import Marina, User
from .models import PlatformPayment, AuditLog, GlobalFeatureFlag


PLAN_PRICES = {'starter': 149, 'professional': 349, 'enterprise': 899}


class StaffUserSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'email', 'name', 'role', 'is_active', 'created_at']

    def get_name(self, obj):
        return f'{obj.first_name} {obj.last_name}'.strip() or obj.email


class MarinaListSerializer(serializers.ModelSerializer):
    mrr = serializers.SerializerMethodField()
    user_count = serializers.SerializerMethodField()

    class Meta:
        model = Marina
        fields = [
            'id', 'name', 'contact_email', 'timezone', 'plan', 'status',
            'total_berths', 'mrr', 'user_count',
            'trial_ends', 'next_renewal', 'suspend_reason',
            'stripe_account_id', 'features', 'mrr_override', 'max_staff',
            'created_at',
        ]

    def get_mrr(self, obj):
        return obj.mrr_override or PLAN_PRICES.get(obj.plan, 0)

    def get_user_count(self, obj):
        return obj.users.filter(is_active=True).count()


class MarinaDetailSerializer(MarinaListSerializer):
    staff = serializers.SerializerMethodField()
    active_bookings = serializers.SerializerMethodField()

    class Meta(MarinaListSerializer.Meta):
        fields = MarinaListSerializer.Meta.fields + [
            'staff', 'active_bookings', 'address', 'phone', 'currency',
            'support_access_granted_until',
        ]

    def get_staff(self, obj):
        users = obj.users.filter(role__in=['owner', 'manager', 'staff']).order_by('role')
        return StaffUserSerializer(users, many=True).data

    def get_active_bookings(self, obj):
        return obj.bookings.filter(
            status__in=['confirmed', 'pending', 'checked_in', 'awaiting_payment', 'pending_payment']
        ).count()


class MarinaUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Marina
        fields = ['plan', 'status', 'trial_ends', 'next_renewal', 'suspend_reason',
                  'features', 'mrr_override', 'max_staff', 'name', 'contact_email']


class PlatformPaymentSerializer(serializers.ModelSerializer):
    marina_name = serializers.CharField(source='marina.name', read_only=True)

    class Meta:
        model = PlatformPayment
        fields = ['id', 'marina', 'marina_name', 'amount', 'status', 'method',
                  'period_start', 'paid_at', 'created_at']


class AuditLogSerializer(serializers.ModelSerializer):
    admin_user_email = serializers.CharField(source='admin_user.email', read_only=True, default=None)
    target_marina_name = serializers.CharField(source='target_marina.name', read_only=True, default=None)

    class Meta:
        model = AuditLog
        fields = ['id', 'admin_user_email', 'action', 'target_marina_name', 'detail', 'created_at']


class GlobalFeatureFlagSerializer(serializers.ModelSerializer):
    class Meta:
        model = GlobalFeatureFlag
        fields = ['name', 'enabled', 'updated_at']
        read_only_fields = ['updated_at']


from apps.accounts.models import MarinaGroup, MarinaGroupMembership


class MarinaGroupMemberSerializer(serializers.ModelSerializer):
    group_name = serializers.CharField(source='group.name', read_only=True)

    class Meta:
        model = MarinaGroupMembership
        fields = ['id', 'marina_id', 'group_name']


class MarinaGroupSerializer(serializers.ModelSerializer):
    marina_count = serializers.SerializerMethodField()
    marinas = serializers.SerializerMethodField()

    class Meta:
        model = MarinaGroup
        fields = [
            'id', 'name', 'slug', 'max_marinas', 'base_currency',
            'billing_contact_email', 'stripe_customer_id',
            'marina_count', 'marinas', 'created_at',
        ]
        read_only_fields = ['id', 'marina_count', 'marinas', 'created_at']

    def get_marina_count(self, obj):
        return obj.memberships.count()

    def get_marinas(self, obj):
        return [
            {'id': m.marina.id, 'name': m.marina.name, 'slug': m.marina.slug}
            for m in obj.memberships.select_related('marina').all()
        ]

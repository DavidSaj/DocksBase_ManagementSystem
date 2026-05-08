from rest_framework import serializers
from apps.tenants.models import CommercialUnit, TenantContact, Tenancy, TenancyDocument, RentScheduleEntry, TenancyTask


class CommercialUnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = CommercialUnit
        fields = '__all__'
        read_only_fields = ['marina']


class TenantContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = TenantContact
        fields = '__all__'
        read_only_fields = ['marina', 'created_at']


class TenancySerializer(serializers.ModelSerializer):
    class Meta:
        model = Tenancy
        fields = '__all__'
        read_only_fields = ['marina', 'deposit_invoice', 'created_at', 'updated_at']

    def validate_rent_chargeable_item(self, value):
        if value and value.category != 'rent':
            raise serializers.ValidationError("rent_chargeable_item must have category='rent'.")
        return value

    def validate_deposit_chargeable_item(self, value):
        if value and value.category != 'deposit':
            raise serializers.ValidationError("deposit_chargeable_item must have category='deposit'.")
        return value

    def validate(self, data):
        unit = data.get('unit', getattr(self.instance, 'unit', None))
        status = data.get('status', getattr(self.instance, 'status', 'active'))
        lease_start = data.get('lease_start', getattr(self.instance, 'lease_start', None))
        lease_end = data.get('lease_end', getattr(self.instance, 'lease_end', None))

        if lease_end and lease_start and lease_end < lease_start:
            raise serializers.ValidationError({'lease_end': 'Lease end must be after lease start.'})

        if status == 'active' and unit:
            qs = Tenancy.objects.filter(unit=unit, status='active')
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError('This unit already has an active tenancy.')

        return data


class TenancyDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = TenancyDocument
        fields = '__all__'
        read_only_fields = ['marina', 'uploaded_at']


class RentScheduleEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = RentScheduleEntry
        fields = [
            'id', 'tenancy', 'marina', 'period_ref', 'due_date', 'amount',
            'status', 'is_pro_rata', 'pro_rata_days', 'pro_rata_total_days',
            'invoice', 'created_at',
        ]
        read_only_fields = fields


class TenancyTaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = TenancyTask
        fields = '__all__'
        read_only_fields = ['marina', 'created_at', 'updated_at']

from rest_framework import serializers
from .models import Vessel, InsuranceRecord, SafetyEquipment, VesselCertificate


class InsuranceSerializer(serializers.ModelSerializer):
    class Meta:
        model = InsuranceRecord
        fields = ['insurer', 'policy_no', 'expires', 'status']


class SafetySerializer(serializers.ModelSerializer):
    class Meta:
        model = SafetyEquipment
        fields = ['flares_exp', 'life_raft_exp', 'epirb_exp', 'extinguisher_exp']


class VesselCertificateSerializer(serializers.ModelSerializer):
    class Meta:
        model = VesselCertificate
        fields = ['id', 'cert_type', 'name', 'issued', 'expires', 'status', 'notes']
        read_only_fields = ['id']


class VesselSerializer(serializers.ModelSerializer):
    insurance = InsuranceSerializer(read_only=True)
    safety = SafetySerializer(read_only=True)
    owner_name = serializers.CharField(source='owner.name', read_only=True, default=None)
    berth_code = serializers.SerializerMethodField()

    class Meta:
        model = Vessel
        fields = [
            'id', 'name', 'reg', 'flag', 'mmsi', 'call_sign', 'vessel_type',
            'loa', 'beam', 'draft', 'air_draft', 'year_built', 'builder', 'model',
            'engine', 'fuel', 'tank_cap', 'fw_tank', 'shore_power', 'mooring_pref',
            'ais_active', 'owner', 'owner_name', 'berth_code', 'insurance', 'safety',
            'created_at',
        ]
        read_only_fields = ['id', 'owner_name', 'berth_code', 'created_at']

    def get_berth_code(self, obj):
        berth = obj.current_berth.first()
        return berth.code if berth else None

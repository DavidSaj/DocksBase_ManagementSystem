from rest_framework import serializers
from .models import Task, Incident, Asset, Defect, MaintenanceTask


class TaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Task
        fields = ['id', 'text', 'location', 'priority', 'assigned_to', 'done', 'created_at']
        read_only_fields = ['created_at']


class IncidentSerializer(serializers.ModelSerializer):
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default='')
    berth_name = serializers.CharField(source='berth.name', read_only=True, default='')

    class Meta:
        model = Incident
        fields = [
            'id', 'vessel', 'vessel_name', 'berth', 'berth_name',
            'description', 'severity', 'reporter', 'notes',
            'resolved', 'occurred_at', 'created_at',
        ]
        read_only_fields = ['created_at']

    def validate_vessel(self, value):
        request = self.context['request']
        if value and value.marina_id != request.user.marina_id:
            raise serializers.ValidationError('Vessel does not belong to this marina.')
        return value

    def validate_berth(self, value):
        request = self.context['request']
        if value and value.marina_id != request.user.marina_id:
            raise serializers.ValidationError('Berth does not belong to this marina.')
        return value


class AssetSerializer(serializers.ModelSerializer):
    class Meta:
        model = Asset
        fields = [
            'id', 'name', 'category', 'location', 'make', 'model',
            'serial', 'purchased', 'cost', 'status', 'last_service',
            'next_service', 'total_maint_cost', 'notes',
        ]


class DefectSerializer(serializers.ModelSerializer):
    asset_name = serializers.CharField(source='asset.name', read_only=True, default='')

    class Meta:
        model = Defect
        fields = [
            'id', 'asset', 'asset_name', 'location', 'description',
            'severity', 'reporter', 'assigned_to', 'status', 'reported_at',
        ]
        read_only_fields = ['reported_at']

    def validate_asset(self, value):
        request = self.context['request']
        if value and value.marina_id != request.user.marina_id:
            raise serializers.ValidationError('Asset does not belong to this marina.')
        return value


class MaintenanceTaskSerializer(serializers.ModelSerializer):
    asset_name = serializers.CharField(source='asset.name', read_only=True, default='')

    class Meta:
        model = MaintenanceTask
        fields = [
            'id', 'asset', 'asset_name', 'defect', 'title', 'description',
            'assigned_to', 'priority', 'status', 'due_date',
            'completed_at', 'completion_notes', 'completion_photo',
        ]
        read_only_fields = ['completed_at']

    def validate_asset(self, value):
        request = self.context['request']
        if value and value.marina_id != request.user.marina_id:
            raise serializers.ValidationError('Asset does not belong to this marina.')
        return value

    def validate_defect(self, value):
        request = self.context['request']
        if value and value.marina_id != request.user.marina_id:
            raise serializers.ValidationError('Defect does not belong to this marina.')
        return value

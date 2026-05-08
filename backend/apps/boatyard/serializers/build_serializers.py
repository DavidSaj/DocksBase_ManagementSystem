"""
apps/boatyard/serializers/build_serializers.py
Track 5 — BuildProject, BOMItem, BuildMilestone serializers.
"""

from rest_framework import serializers

from ..models import BuildProject, BOMItem, BuildMilestone


class BuildMilestoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = BuildMilestone
        fields = [
            'id', 'build_project', 'name', 'description',
            'planned_date', 'actual_date',
            'payment_amount', 'payment_due_days', 'invoice',
            'sort_order',
        ]
        read_only_fields = ['invoice']


class BOMItemSerializer(serializers.ModelSerializer):
    line_cost = serializers.DecimalField(
        max_digits=12, decimal_places=2,
        read_only=True, source='line_cost',
    )

    class Meta:
        model = BOMItem
        fields = [
            'id', 'build_project', 'part', 'description',
            'quantity', 'unit', 'unit_cost_at_order', 'supplier',
            'procurement_status', 'expected_delivery', 'line_cost',
        ]


class BuildProjectSerializer(serializers.ModelSerializer):
    milestones = BuildMilestoneSerializer(many=True, read_only=True)
    bom_items  = BOMItemSerializer(many=True, read_only=True)

    class Meta:
        model = BuildProject
        fields = [
            'id', 'work_order', 'vessel', 'project_name',
            'hull_number', 'vessel_type', 'loa_m', 'contract_value',
            'status', 'keel_laid_date', 'launch_target_date',
            'actual_launch_date', 'notes',
            'milestones', 'bom_items',
        ]

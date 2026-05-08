"""
apps/boatyard/serializers/batch_serializers.py
Track 5 — BatchJobPost and BatchJobPostLine serializers.
"""

from rest_framework import serializers

from ..models import BatchJobPost, BatchJobPostLine


class BatchJobPostLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = BatchJobPostLine
        fields = [
            'id', 'batch', 'work_order', 'work_order_task',
            'hours', 'material_cost', 'description',
        ]


class BatchJobPostSerializer(serializers.ModelSerializer):
    lines = BatchJobPostLineSerializer(many=True, read_only=True)

    class Meta:
        model = BatchJobPost
        fields = [
            'id', 'posted_by', 'posted_at', 'notes', 'lines',
        ]
        read_only_fields = ['posted_at']

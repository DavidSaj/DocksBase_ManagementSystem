"""
apps/boatyard/serializers/template_serializers.py
Track 5 — JobTemplate, JobTemplateTask, JobTemplatePart serializers.
"""

from rest_framework import serializers

from ..models import JobTemplate, JobTemplateTask, JobTemplatePart


class JobTemplateTaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = JobTemplateTask
        fields = [
            'id', 'template', 'title', 'description',
            'duration_days', 'estimated_hours', 'sort_order',
        ]


class JobTemplatePartSerializer(serializers.ModelSerializer):
    class Meta:
        model = JobTemplatePart
        fields = [
            'id', 'template', 'part', 'description', 'quantity',
        ]


class JobTemplateSerializer(serializers.ModelSerializer):
    tasks = JobTemplateTaskSerializer(many=True, read_only=True)
    parts = JobTemplatePartSerializer(many=True, read_only=True)

    class Meta:
        model = JobTemplate
        fields = [
            'id', 'name', 'category', 'description', 'is_active',
            'estimated_total_hours', 'created_at',
            'tasks', 'parts',
        ]
        read_only_fields = ['created_at']

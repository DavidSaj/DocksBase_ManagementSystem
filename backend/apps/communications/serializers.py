from rest_framework import serializers
from apps.communications.models import (
    MessageLog, MessageTemplate, WhatsAppTemplate, Journey, JourneyStep,
    JourneyEnrollment, JourneyStepLog, AlertRoute,
    DotdigitalConfig, DotdigitalSegmentMapping,
    EmailCampaign, EmailCampaignVariant, ABTest,
    ReviewRequest, ReviewConfig,
)


class MessageTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = MessageTemplate
        fields = ['id', 'name', 'channel', 'subject', 'body', 'is_active', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']


class MessageLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = MessageLog
        fields = '__all__'
        read_only_fields = ['marina']


class WhatsAppTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = WhatsAppTemplate
        fields = '__all__'
        read_only_fields = ['marina']


class JourneyStepSerializer(serializers.ModelSerializer):
    class Meta:
        model = JourneyStep
        fields = '__all__'


class JourneySerializer(serializers.ModelSerializer):
    steps = JourneyStepSerializer(many=True, read_only=True)

    class Meta:
        model = Journey
        fields = '__all__'
        read_only_fields = ['marina']


class JourneyEnrollmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = JourneyEnrollment
        fields = '__all__'


class JourneyStepLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = JourneyStepLog
        fields = '__all__'


class AlertRouteSerializer(serializers.ModelSerializer):
    class Meta:
        model = AlertRoute
        fields = '__all__'
        read_only_fields = ['marina']


class DotdigitalConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = DotdigitalConfig
        fields = '__all__'
        read_only_fields = ['marina']
        extra_kwargs = {
            'api_password': {'write_only': True},
        }


class DotdigitalSegmentMappingSerializer(serializers.ModelSerializer):
    class Meta:
        model = DotdigitalSegmentMapping
        fields = '__all__'
        read_only_fields = ['marina']


class EmailCampaignVariantSerializer(serializers.ModelSerializer):
    open_rate = serializers.FloatField(read_only=True)
    click_rate = serializers.FloatField(read_only=True)

    class Meta:
        model = EmailCampaignVariant
        fields = '__all__'


class ABTestSerializer(serializers.ModelSerializer):
    class Meta:
        model = ABTest
        fields = '__all__'


class EmailCampaignSerializer(serializers.ModelSerializer):
    variants = EmailCampaignVariantSerializer(many=True, read_only=True)
    ab_test = ABTestSerializer(read_only=True)

    class Meta:
        model = EmailCampaign
        fields = '__all__'
        read_only_fields = ['marina']


class ReviewRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReviewRequest
        fields = '__all__'
        read_only_fields = ['marina']


class ReviewConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReviewConfig
        fields = '__all__'
        read_only_fields = ['marina']

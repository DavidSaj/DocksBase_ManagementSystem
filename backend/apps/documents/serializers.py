from rest_framework import serializers
from .models import DocTemplate, Envelope, MemberDocument


class DocTemplateSerializer(serializers.ModelSerializer):
    is_active_waiver = serializers.SerializerMethodField()

    class Meta:
        model = DocTemplate
        fields = [
            'id', 'name', 'category', 'pages', 'fields_count',
            'uses_count', 'last_used', 'created_at',
            'file', 'dropboxsign_template_id', 'is_active_waiver',
        ]
        read_only_fields = ['uses_count', 'last_used', 'created_at', 'dropboxsign_template_id', 'is_active_waiver']

    def get_is_active_waiver(self, obj):
        if not obj.dropboxsign_template_id:
            return False
        return obj.dropboxsign_template_id == obj.marina.waiver_template_id

    def validate_file(self, value):
        if not value.name.lower().endswith('.pdf'):
            raise serializers.ValidationError('Only PDF files are allowed.')
        if hasattr(value, 'content_type') and value.content_type not in ('application/pdf',):
            raise serializers.ValidationError('Invalid file type.')
        return value


class EnvelopeSerializer(serializers.ModelSerializer):
    template_name = serializers.CharField(source='template.name', read_only=True)
    recipient_name = serializers.CharField(source='recipient.name', read_only=True, default='')
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default='')

    class Meta:
        model = Envelope
        fields = [
            'id', 'template', 'template_name',
            'recipient', 'recipient_name',
            'vessel', 'vessel_name',
            'sent_at', 'expires_at', 'completed_at',
            'status', 'reminders_sent', 'dropboxsign_request_id',
        ]
        read_only_fields = ['sent_at', 'completed_at', 'status', 'reminders_sent', 'dropboxsign_request_id']


class MemberDocumentSerializer(serializers.ModelSerializer):
    member_name = serializers.CharField(source='member.name', read_only=True)
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default='')

    class Meta:
        model = MemberDocument
        fields = [
            'id', 'member', 'member_name', 'vessel', 'vessel_name',
            'doc_type', 'file', 'expiry_date', 'status', 'notes', 'uploaded_at',
        ]
        read_only_fields = ['uploaded_at']

    def validate_file(self, value):
        allowed_extensions = ('.pdf', '.jpg', '.jpeg', '.png')
        allowed_content_types = ('application/pdf', 'image/jpeg', 'image/png')
        if not value.name.lower().endswith(allowed_extensions):
            raise serializers.ValidationError('Only PDF and common image files (JPEG, PNG) are allowed.')
        if hasattr(value, 'content_type') and value.content_type not in allowed_content_types:
            raise serializers.ValidationError('Invalid file type.')
        return value

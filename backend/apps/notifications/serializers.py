from rest_framework import serializers
from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ['id', 'kind', 'title', 'body', 'link_screen', 'link_id', 'read', 'created_at']
        read_only_fields = ['id', 'kind', 'title', 'body', 'link_screen', 'link_id', 'created_at']

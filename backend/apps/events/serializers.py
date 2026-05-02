from rest_framework import serializers
from .models import Event, VenueHire


class EventSerializer(serializers.ModelSerializer):
    class Meta:
        model = Event
        fields = [
            'id', 'name', 'event_type', 'location', 'organiser', 'contact',
            'start_date', 'end_date', 'attendance', 'fleet_count',
            'berths_blocked', 'status', 'revenue',
        ]
        read_only_fields = ['id']


class VenueHireSerializer(serializers.ModelSerializer):
    class Meta:
        model = VenueHire
        fields = [
            'id', 'name', 'capacity_seated', 'capacity_standing',
            'facilities', 'day_rate', 'hourly_rate', 'status',
        ]
        read_only_fields = ['id']

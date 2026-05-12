from rest_framework import serializers
from apps.documents.models import MemberDocument
from apps.utilities.models import SmartMeter


class PortalMeterSerializer(serializers.Serializer):
    id                 = serializers.IntegerField(source='pk')
    label              = serializers.CharField()
    meter_type         = serializers.CharField()
    berth_code         = serializers.SerializerMethodField()
    last_reading_value = serializers.SerializerMethodField()
    last_reading_unit  = serializers.SerializerMethodField()
    last_reading_at    = serializers.SerializerMethodField()

    def get_berth_code(self, meter):
        return meter.berth.code if meter.berth else None

    def get_last_reading_value(self, meter):
        reading = meter.readings.order_by('-recorded_at').first()
        if not reading:
            return None
        return float(reading.reading_kwh or reading.reading_m3 or 0)

    def get_last_reading_unit(self, meter):
        return 'kWh' if meter.meter_type == 'electricity' else 'm³'

    def get_last_reading_at(self, meter):
        reading = meter.readings.order_by('-recorded_at').first()
        return reading.recorded_at if reading else None


class PortalDocumentSerializer(serializers.ModelSerializer):
    doc_type_display = serializers.CharField(source='get_doc_type_display', read_only=True)
    status_display   = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = MemberDocument
        fields = ['id', 'doc_type', 'doc_type_display', 'status', 'status_display',
                  'expiry_date', 'uploaded_at', 'file']
        read_only_fields = ['id', 'status', 'status_display', 'doc_type_display', 'uploaded_at']

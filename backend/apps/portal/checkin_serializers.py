from rest_framework import serializers
from apps.reservations.models import Booking
from .checkin_utils import is_arrival_day


class PortalBookingSerializer(serializers.ModelSerializer):
    berth_code  = serializers.CharField(source='berth.code',  read_only=True, default=None)
    berth_pier  = serializers.CharField(source='berth.pier.label', read_only=True, default=None)
    is_arrival_day = serializers.SerializerMethodField()
    marina_wallet  = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = [
            'id', 'check_in', 'check_out', 'status',
            'berth_code', 'berth_pier',
            'guest_name', 'guest_email',
            'boat_loa', 'boat_beam', 'boat_draft',
            'waiver_envelope_id', 'waiver_signed',
            'insurance_doc',
            'pre_cleared', 'self_checked_in', 'self_checked_in_at',
            'is_arrival_day', 'marina_wallet',
        ]
        read_only_fields = fields

    def get_is_arrival_day(self, booking):
        return is_arrival_day(booking)

    def get_marina_wallet(self, booking):
        if not booking.self_checked_in:
            return None
        m = booking.marina
        return {
            'wifi_network':          m.wallet_wifi_network,
            'wifi_password':         m.wallet_wifi_password,
            'gate_codes':            m.wallet_gate_codes,
            'harbour_master_phone':  m.wallet_harbour_master_phone,
            'vhf_channel':           m.wallet_vhf_channel,
            'office_hours':          m.wallet_office_hours,
            'marina_name':           m.name,
        }

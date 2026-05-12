from rest_framework import serializers
from apps.reservations.models import Booking
from apps.utilities.models import WashToken
from .checkin_utils import is_arrival_day


class WashTokenSerializer(serializers.Serializer):
    facility   = serializers.CharField()
    token_code = serializers.CharField()
    expires_at = serializers.DateTimeField()


class PortalBookingSerializer(serializers.ModelSerializer):
    berth_code  = serializers.CharField(source='berth.code',  read_only=True, default=None)
    berth_pier  = serializers.CharField(source='berth.pier.label', read_only=True, default=None)
    is_arrival_day = serializers.SerializerMethodField()
    marina_wallet  = serializers.SerializerMethodField()

    marina_name = serializers.CharField(source='marina.name', read_only=True)
    marina_info = serializers.SerializerMethodField()
    wash_tokens = serializers.SerializerMethodField()

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
            'is_arrival_day', 'marina_name', 'marina_info', 'marina_wallet', 'wash_tokens',
        ]
        read_only_fields = fields

    def get_is_arrival_day(self, booking):
        return is_arrival_day(booking)

    def get_marina_info(self, booking):
        m = booking.marina
        return {
            'phone':                 m.phone or None,
            'contact_email':         m.contact_email or None,
            'harbour_master_phone':  m.wallet_harbour_master_phone or None,
            'vhf_channel':           m.wallet_vhf_channel or None,
            'office_hours':          m.wallet_office_hours or None,
            'address':               m.address or None,
            'website':               m.website or None,
            'lat':                   float(m.lat) if m.lat else None,
            'lng':                   float(m.lng) if m.lng else None,
            'has_map':               bool((m.onboarding or {}).get('draw_map', False)),
            'app_config':            m.app_config or {},
        }

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

    def get_wash_tokens(self, booking):
        from django.utils import timezone
        email = booking.guest_email
        if not email:
            return []
        tokens = WashToken.objects.filter(
            marina=booking.marina,
            member__email=email,
            status='issued',
        ).exclude(expires_at__lt=timezone.now())
        return WashTokenSerializer(tokens, many=True).data

from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from apps.access_control.models import AccessEvent
from apps.access_control.serializers import AccessEventSerializer
from apps.access_control.views.mixins import MarinaFilteredMixin


class AccessEventViewSet(MarinaFilteredMixin, viewsets.ReadOnlyModelViewSet):
    """
    Immutable audit log — read-only.
    Filter params: ?member, ?reader, ?zone, ?granted, ?from, ?to, ?credential_type
    """
    serializer_class = AccessEventSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs     = AccessEvent.objects.select_related('reader', 'card', 'member').prefetch_related('cctv_cameras')
        marina = self.request.user.marina
        qs     = qs.filter(marina=marina)

        params = self.request.query_params
        if member_id := params.get('member'):
            qs = qs.filter(member_id=member_id)
        if reader_id := params.get('reader'):
            qs = qs.filter(reader_id=reader_id)
        if zone_id := params.get('zone'):
            qs = qs.filter(reader__zone_id=zone_id)
        if granted := params.get('granted'):
            qs = qs.filter(granted=granted.lower() == 'true')
        if from_dt := params.get('from'):
            qs = qs.filter(occurred_at__gte=from_dt)
        if to_dt := params.get('to'):
            qs = qs.filter(occurred_at__lte=to_dt)
        if cred_type := params.get('credential_type'):
            qs = qs.filter(credential_type=cred_type)

        return qs

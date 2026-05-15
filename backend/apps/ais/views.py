from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.ais.services import get_inbound_etas


class InboundETAView(APIView):
    """
    GET /api/v1/ais/inbound/
    Return upcoming bookings whose vessel is within AIS range of the marina,
    sorted by closest ETA first.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        marina = request.user.marina
        return Response({
            'inbound':    get_inbound_etas(marina),
            'fetched_at': timezone.now().isoformat(),
        })

# backend/apps/portal/services_views.py
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status as http_status
from rest_framework.permissions import IsAuthenticated

from apps.members.models import Member

from .member_auth import PortalMemberAuthentication
from .models import CraneRequest


def _get_member(request):
    """Return Member for the authenticated PortalMemberUser, scoped to marina."""
    return (
        Member.objects
        .filter(id=request.user.member_id, marina__slug=request.user.marina_slug)
        .select_related('marina')
        .first()
    )


class PortalMemberCraneRequestView(APIView):
    authentication_classes = [PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    VALID_SERVICE_TYPES = {'launch', 'haul_out', 'both'}

    def post(self, request):
        member = _get_member(request)
        if member is None:
            return Response(
                {'detail': 'Member not found.'},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        service_type = request.data.get('service_type', '')
        requested_date = request.data.get('requested_date', '')
        notes = request.data.get('notes', '').strip()

        if service_type not in self.VALID_SERVICE_TYPES:
            return Response(
                {'detail': 'Invalid service_type.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        if not requested_date:
            return Response(
                {'detail': 'requested_date is required.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        crane_req = CraneRequest.objects.create(
            member=member,
            service_type=service_type,
            requested_date=requested_date,
            notes=notes,
        )
        return Response(
            {'id': crane_req.id, 'status': crane_req.status},
            status=http_status.HTTP_201_CREATED,
        )

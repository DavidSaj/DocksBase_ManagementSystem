from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status as http_status
from rest_framework.permissions import IsAuthenticated

from apps.members.models import Member
from apps.boatyard.models import WorkOrder
from apps.documents.models import MemberDocument
from apps.utilities.models import SmartMeter

from .member_auth import PortalMemberAuthentication
from .permissions import require_feature
from .member_serializers import PortalMeterSerializer, PortalDocumentSerializer


def _get_member(request):
    return (
        Member.objects
        .filter(id=request.user.member_id, marina__slug=request.user.marina_slug)
        .select_related('marina')
        .first()
    )


class PortalGateView(APIView):
    authentication_classes = [PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        marina = member.marina
        app_config = marina.app_config or {}
        return Response({
            'gate_codes':    marina.wallet_gate_codes or [],
            'wifi_name':     app_config.get('wifi_name') or marina.wallet_wifi_network or '',
            'wifi_password': app_config.get('wifi_password') or marina.wallet_wifi_password or '',
        })


class PortalUtilitiesView(APIView):
    authentication_classes = [PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        require_feature(member, 'enable_utilities')
        meters = (
            SmartMeter.objects
            .filter(marina=member.marina, is_active=True, berth__isnull=False)
            .select_related('berth')
            .prefetch_related('readings')
        )
        return Response({'meters': PortalMeterSerializer(meters, many=True).data})


VALID_URGENCIES = {'routine', 'urgent', 'emergency'}
URGENCY_TO_PRIORITY = {'routine': 'low', 'urgent': 'high', 'emergency': 'urgent'}


class PortalWorkOrderView(APIView):
    authentication_classes = [PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        require_feature(member, 'enable_boatyard')
        orders = WorkOrder.objects.filter(
            marina=member.marina,
            title__startswith='Member WO:',
        ).order_by('-created_at')[:20]
        return Response({'work_orders': [
            {'ref': f'WO-{o.id}', 'title': o.title, 'status': o.status, 'created_at': o.created_at}
            for o in orders
        ]})

    def post(self, request):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        require_feature(member, 'enable_boatyard')

        raw_desc = request.data.get('description', '')
        description = raw_desc.strip() if isinstance(raw_desc, str) else ''
        if not description:
            return Response({'detail': 'description is required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        urgency = request.data.get('urgency', 'routine')
        if urgency not in VALID_URGENCIES:
            return Response(
                {'detail': 'urgency must be routine, urgent, or emergency.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        work_order = WorkOrder.objects.create(
            marina=member.marina,
            title=f'Member WO: {description[:80]}',
            description=description,
            priority=URGENCY_TO_PRIORITY[urgency],
            status='pending_auth',
        )
        return Response({'ref': f'WO-{work_order.id}'}, status=http_status.HTTP_201_CREATED)


class PortalDocumentListView(APIView):
    authentication_classes = [PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        require_feature(member, 'enable_documents')
        docs = MemberDocument.objects.filter(member=member, marina=member.marina)
        return Response({'documents': PortalDocumentSerializer(docs, many=True).data})

    def post(self, request):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        require_feature(member, 'enable_documents')

        doc_type = request.data.get('doc_type', '')
        if doc_type not in ('insurance', 'registration'):
            return Response(
                {'detail': 'doc_type must be insurance or registration.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        file = request.FILES.get('file')
        if not file:
            return Response({'detail': 'file is required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        doc, _ = MemberDocument.objects.get_or_create(
            member=member,
            marina=member.marina,
            doc_type=doc_type,
            defaults={'status': 'pending_upload'},
        )
        doc.file = file
        doc.status = 'uploaded'
        # uploaded_at is auto_now_add=True — excluded from update_fields
        doc.save(update_fields=['file', 'status'])
        return Response(PortalDocumentSerializer(doc).data, status=http_status.HTTP_201_CREATED)


class PortalDocumentDetailView(APIView):
    authentication_classes = [PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        require_feature(member, 'enable_documents')
        try:
            doc = MemberDocument.objects.get(pk=pk, member=member, marina=member.marina)
        except MemberDocument.DoesNotExist:
            return Response({'detail': 'Document not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        doc.file.delete(save=False)
        doc.status = 'pending_upload'
        doc.file = None
        doc.save(update_fields=['file', 'status'])
        return Response(status=http_status.HTTP_204_NO_CONTENT)

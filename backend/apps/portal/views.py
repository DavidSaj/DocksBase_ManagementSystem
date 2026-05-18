from rest_framework import generics, permissions, status as http_status
from rest_framework.exceptions import NotFound
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from apps.accounts.views import IsMarinaStaff
from apps.billing.models import Invoice
from apps.billing import stripe_service as _stripe_svc
from apps.members.models import Member
from apps.reservations.models import Booking
from apps.vessels.models import Vessel
from .boater_auth import BoaterTokenAuthentication
from .boater_context import resolve_portal_member
from .member_auth import PortalMemberAuthentication
from .models import AbsenceReport, CraneRequest
from .serializers import PortalInvoiceSerializer, AbsenceReportSerializer, CraneRequestSerializer, CraneRequestStaffSerializer, PortalBerthSerializer, PortalVesselSerializer


class MarinaPublicView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        if request.tenant is None:
            return Response({'error': 'X-Marina-Slug header is required.'}, status=400)
        marina = request.tenant
        cfg = getattr(marina, 'widget_config', None)
        return Response({
            'id': marina.id,
            'name': marina.name,
            'slug': marina.slug,
            'timezone': marina.timezone,
            'currency': marina.currency,
            'contact_email': marina.contact_email,
            'phone': marina.phone,
            'booking_mode': marina.booking_mode,
            'vat_rate': str(marina.vat_rate),
            'logo_url': cfg.logo_url if cfg else '',
            'app_config': marina.app_config or {},
        })


class IsBoater(permissions.BasePermission):
    message = 'No member profile linked to this account.'

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated and request.user.role == 'boater'):
            return False
        member = getattr(request.user, 'member_profile', None)
        if member is None:
            return False
        return member.marina_id == request.user.marina_id


class PortalInvoiceListView(generics.ListAPIView):
    authentication_classes = [BoaterTokenAuthentication, PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]
    serializer_class = PortalInvoiceSerializer

    def get_queryset(self):
        member = resolve_portal_member(self.request)
        if member is None:
            return Invoice.objects.none()
        return Invoice.objects.filter(member=member, marina=member.marina).order_by('-created_at')


class AbsenceReportCreateView(generics.CreateAPIView):
    permission_classes = [IsBoater]
    serializer_class = AbsenceReportSerializer

    def perform_create(self, serializer):
        member = self.request.user.member_profile
        serializer.save(member=member)


class CraneRequestListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsBoater]
    serializer_class = CraneRequestSerializer

    def get_queryset(self):
        member = self.request.user.member_profile
        return CraneRequest.objects.filter(member=member)

    def perform_create(self, serializer):
        member = self.request.user.member_profile
        serializer.save(member=member)


class CraneRequestStaffListView(generics.ListAPIView):
    permission_classes = [IsMarinaStaff]
    serializer_class = CraneRequestStaffSerializer
    pagination_class = None

    def get_queryset(self):
        qs = CraneRequest.objects.filter(
            member__marina=self.request.user.marina
        ).select_related('member').order_by('-created_at')
        status = self.request.query_params.get('status')
        if status:
            qs = qs.filter(status=status)
        return qs


class CraneRequestStaffDetailView(generics.UpdateAPIView):
    permission_classes = [IsMarinaStaff]
    serializer_class = CraneRequestStaffSerializer
    http_method_names = ['patch']

    def get_queryset(self):
        return CraneRequest.objects.filter(member__marina=self.request.user.marina)


class PortalBerthView(generics.ListAPIView):
    permission_classes = [IsBoater]
    serializer_class = PortalBerthSerializer
    pagination_class = None

    def get_queryset(self):
        member = self.request.user.member_profile
        return Booking.objects.filter(
            vessel__owner=member,
            marina=self.request.user.marina,
            status__in=['checked_in', 'pending'],
        ).select_related('berth__pier').order_by('-check_in')


class PortalVesselView(generics.RetrieveAPIView):
    permission_classes = [IsBoater]
    serializer_class = PortalVesselSerializer

    def get_object(self):
        member = self.request.user.member_profile
        vessel = (
            Vessel.objects
            .filter(owner=member, marina=self.request.user.marina)
            .prefetch_related('certificates')
            .first()
        )
        if vessel is None:
            raise NotFound('No vessel on file.')
        return vessel


class PortalInvoicePayView(APIView):
    permission_classes = [IsBoater]

    def post(self, request, pk):
        member = request.user.member_profile
        try:
            invoice = Invoice.objects.select_related('marina').get(
                pk=pk,
                member=member,
                marina=request.user.marina,
                status__in=['unpaid', 'open'],
            )
        except Invoice.DoesNotExist:
            return Response(
                {'detail': 'Invoice not found or not payable.'},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        if not invoice.marina.stripe_account_id:
            return Response(
                {'detail': 'Payments not configured for this marina.'},
                status=http_status.HTTP_402_PAYMENT_REQUIRED,
            )

        amount_cents = int(invoice.total * 100)
        currency = invoice.marina.currency.lower()
        stripe_account = invoice.marina.stripe_account_id

        if invoice.stripe_payment_intent_id:
            try:
                intent = _stripe_svc.stripe.PaymentIntent.retrieve(
                    invoice.stripe_payment_intent_id,
                    stripe_account=stripe_account,
                )
                if intent['status'] == 'requires_payment_method':
                    if intent['amount'] != amount_cents:
                        intent = _stripe_svc.stripe.PaymentIntent.modify(
                            intent['id'],
                            amount=amount_cents,
                            stripe_account=stripe_account,
                        )
                    return Response({
                        'client_secret': intent['client_secret'],
                        'amount': str(invoice.total),
                        'currency': currency,
                        'stripe_account_id': stripe_account,
                    })
            except _stripe_svc.stripe.error.InvalidRequestError as e:
                if e.code != 'resource_missing':
                    raise

        intent = _stripe_svc.stripe.PaymentIntent.create(
            amount=amount_cents,
            currency=currency,
            metadata={'invoice_id': str(invoice.pk)},
            stripe_account=stripe_account,
        )
        invoice.stripe_payment_intent_id = intent['id']
        invoice.save(update_fields=['stripe_payment_intent_id'])

        return Response({
            'client_secret': intent['client_secret'],
            'amount': str(invoice.total),
            'currency': currency,
            'stripe_account_id': stripe_account,
        }, status=http_status.HTTP_201_CREATED)

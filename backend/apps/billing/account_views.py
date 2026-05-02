from decimal import Decimal
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import F, Sum, Value, DecimalField
from django.db.models.functions import Coalesce
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import status as http_status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.members.models import Member
from .models import Invoice, AccountPayment

User = get_user_model()


SOURCE_TO_CAT = {
    'berth': 'berth',
    'booking': 'berth',
    'fuel_dock': 'fuel',
    'restaurant_order': 'restaurant',
}


def _berth_code_for_member(member):
    from apps.reservations.models import Booking
    booking = (
        Booking.objects
        .filter(vessel__owner=member, status='checked_in')
        .select_related('berth')
        .order_by('-check_in')
        .first()
    )
    return booking.berth.code if (booking and booking.berth) else None


def _credit_on_account(member):
    return member.account_payments.aggregate(
        total=Coalesce(
            Sum('credit_remaining'),
            Value(Decimal('0.00'), output_field=DecimalField(max_digits=10, decimal_places=2)),
        )
    )['total']


def _build_detail(member):
    """Shared serialiser used by AccountDetailView and MyAccountView."""
    open_invoices = list(
        Invoice.objects
        .filter(member=member, status='open')
        .prefetch_related('allocations', 'items')
        .order_by(F('due_date').asc(nulls_last=True), 'created_at')
    )

    total_outstanding = Decimal('0.00')
    by_category = {
        'berth': Decimal('0'), 'fuel': Decimal('0'),
        'restaurant': Decimal('0'), 'other': Decimal('0'),
    }
    invoices_data = []

    for inv in open_invoices:
        already_paid = sum(
            (a.allocated_amount for a in inv.allocations.all()),
            Decimal('0.00')
        ).quantize(Decimal('0.01'))
        balance = inv.total - already_paid
        total_outstanding += balance
        cat = SOURCE_TO_CAT.get(inv.source_type, 'other')
        by_category[cat] += balance
        invoices_data.append({
            'id': inv.pk,
            'invoice_number': inv.invoice_number,
            'source_type': inv.source_type,
            'total': str(inv.total),
            'amount_paid_so_far': str(already_paid),
            'due_date': str(inv.due_date) if inv.due_date else None,
            'status': inv.status,
            'created_at': inv.created_at.isoformat(),
            'items': [
                {
                    'description': item.description,
                    'quantity': str(item.quantity),
                    'unit_price': str(item.unit_price),
                    'total_price': str(item.total_price),
                }
                for item in inv.items.all()
            ],
        })

    credit = _credit_on_account(member)
    portal_active = bool(member.boater_user_id and member.boater_user.is_active)

    return {
        'member': {
            'id': member.pk,
            'name': member.name,
            'email': member.email,
            'member_type': member.member_type,
            'berth_code': _berth_code_for_member(member),
            'portal_active': portal_active,
        },
        'summary': {
            'total_outstanding': str(total_outstanding),
            'credit_on_account': str(credit),
            'by_category': {k: str(v) for k, v in by_category.items()},
        },
        'open_invoices': invoices_data,
    }


class AccountListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        marina = request.user.marina
        qs = (
            Member.objects
            .filter(marina=marina)
            .prefetch_related('invoices__allocations', 'account_payments')
            .select_related('boater_user')
        )
        search = request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(name__icontains=search)

        show_all = request.query_params.get('show_all', '').lower() == 'true'
        results = []

        for member in qs:
            open_invoices = [inv for inv in member.invoices.all() if inv.status == 'open']
            total_outstanding = Decimal('0.00')
            oldest_due = None

            for inv in open_invoices:
                already_paid = sum(
                    (a.allocated_amount for a in inv.allocations.all()),
                    Decimal('0.00')
                ).quantize(Decimal('0.01'))
                total_outstanding += inv.total - already_paid
                if inv.due_date and (oldest_due is None or inv.due_date < oldest_due):
                    oldest_due = inv.due_date

            if not show_all and total_outstanding == Decimal('0.00'):
                continue

            credit = sum(
                (p.credit_remaining for p in member.account_payments.all()),
                Decimal('0.00')
            )
            results.append({
                'member_id': member.pk,
                'name': member.name,
                'member_type': member.member_type,
                'berth_code': _berth_code_for_member(member),
                'total_outstanding': str(total_outstanding.quantize(Decimal('0.01'))),
                'credit_on_account': str(credit),
                'open_invoice_count': len(open_invoices),
                'oldest_due_date': str(oldest_due) if oldest_due else None,
                'portal_active': bool(member.boater_user_id and member.boater_user.is_active),
            })

        results.sort(key=lambda r: Decimal(r['total_outstanding']), reverse=True)
        return Response({'results': results})


class AccountDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, member_id):
        try:
            member = (
                Member.objects
                .select_related('boater_user')
                .get(pk=member_id, marina=request.user.marina)
            )
        except Member.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        return Response(_build_detail(member))


class RecordPaymentView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, member_id):
        try:
            member = Member.objects.get(pk=member_id, marina=request.user.marina)
        except Member.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        try:
            amount = Decimal(str(request.data.get('amount', 0)))
        except Exception:
            return Response({'detail': 'Invalid amount.'}, status=http_status.HTTP_400_BAD_REQUEST)

        method = request.data.get('method', '')
        valid_methods = [m[0] for m in AccountPayment.METHOD_CHOICES]
        if method not in valid_methods:
            return Response(
                {'detail': f"method must be one of: {', '.join(valid_methods)}"},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        from .allocation_service import allocate_payment
        try:
            with transaction.atomic():
                _, result = allocate_payment(
                    member=member,
                    amount=amount,
                    method=method,
                    notes=request.data.get('notes', ''),
                )
        except ValueError as e:
            return Response({'detail': str(e)}, status=http_status.HTTP_400_BAD_REQUEST)

        return Response(result)


class GenerateInviteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, member_id):
        try:
            member = (
                Member.objects
                .select_related('boater_user')
                .get(pk=member_id, marina=request.user.marina)
            )
        except Member.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        if not member.email:
            return Response(
                {'detail': 'Member has no email address.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        try:
            with transaction.atomic():
                if member.boater_user is None:
                    user = User.objects.create_user(
                        email=member.email,
                        password=None,
                        marina=member.marina,
                        role='boater',
                        is_active=False,
                    )
                    member.boater_user = user
                    member.save(update_fields=['boater_user'])
                else:
                    user = member.boater_user

                uid = urlsafe_base64_encode(force_bytes(user.pk))
                token = default_token_generator.make_token(user)
                portal_url = getattr(settings, 'PORTAL_BASE_URL', 'https://portal.docksbase.com')
                link = f'{portal_url}/activate/{uid}/{token}/'

                send_mail(
                    subject='Your DocksBase Boater Portal Access',
                    message=(
                        f'Hello {member.name},\n\n'
                        f'You have been invited to access your boater account at '
                        f'{request.user.marina.name}.\n\n'
                        f'Set your password here:\n{link}\n\n'
                        f'This link expires in 3 days.\n\nDocksBase'
                    ),
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[member.email],
                    fail_silently=False,
                )
        except Exception:
            return Response(
                {'detail': 'Failed to send invite email. Please try again.'},
                status=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response({'detail': f'Invite sent to {member.email}.'})

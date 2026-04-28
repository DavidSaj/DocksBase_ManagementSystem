import datetime
from django.utils import timezone
from rest_framework import generics, serializers as drf_serializers
from django_filters.rest_framework import DjangoFilterBackend
from .models import FuelDockEntry
from .serializers import FuelDockEntrySerializer
from .notifications import notify_sms


VALID_TRANSITIONS = {
    'waiting':  'next',
    'next':     'service',
    'service':  'completed',
}


def _get_phone(entry):
    if entry.member and entry.member.phone:
        return entry.member.phone
    return entry.guest_phone


def _bill_completion(entry, total_amount, now):
    """Route billing on completion. Returns dict of extra fields to save on the entry."""
    from apps.billing.models import Invoice

    if entry.member_id and total_amount is not None:
        due = now.date() + datetime.timedelta(days=entry.marina.payment_terms)
        invoice = Invoice.objects.create(
            marina=entry.marina,
            member=entry.member,
            vessel=entry.vessel,
            invoice_type='fuel',
            amount=total_amount,
            issued=now.date(),
            due=due,
            status='unpaid',
        )
        return {'invoice': invoice}

    return {'pos_paid': True}


class FuelQueueListCreateView(generics.ListCreateAPIView):
    serializer_class = FuelDockEntrySerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status', 'fuel_berth']

    def get_queryset(self):
        qs = FuelDockEntry.objects.filter(marina=self.request.user.marina).select_related(
            'vessel', 'member', 'invoice'
        )
        if self.request.query_params.get('active', '1') == '1':
            qs = qs.exclude(status='completed')
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class FuelQueueDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = FuelDockEntrySerializer

    def get_queryset(self):
        return FuelDockEntry.objects.filter(marina=self.request.user.marina).select_related(
            'vessel', 'member'
        )

    def perform_update(self, serializer):
        entry      = self.get_object()
        new_status = serializer.validated_data.get('status', entry.status)
        now        = timezone.now()
        extra      = {}

        if new_status != entry.status:
            expected_next = VALID_TRANSITIONS.get(entry.status)
            if new_status != expected_next:
                raise drf_serializers.ValidationError(
                    {'status': f'Invalid transition: {entry.status} → {new_status}'}
                )
            if new_status == 'next':
                notify_sms(_get_phone(entry), 'Please approach the fuel dock — you are next.')
            if new_status == 'service':
                extra['service_start'] = now
            if new_status == 'completed':
                actual = serializer.validated_data.get('actual_litres', entry.actual_litres)
                price  = serializer.validated_data.get('price_per_litre', entry.price_per_litre)
                total  = (actual * price) if (actual and price) else None
                extra['completed_at']  = now
                extra['total_amount']  = total
                extra.update(_bill_completion(entry, total, now))

        serializer.save(**extra)

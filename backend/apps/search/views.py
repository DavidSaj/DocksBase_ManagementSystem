from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db import connection


THRESHOLD = 0.1
TOP_N = 3

_USE_TRIGRAM = None


def _use_trigram():
    """Return True if the current DB backend supports TrigramSimilarity."""
    global _USE_TRIGRAM
    if _USE_TRIGRAM is None:
        _USE_TRIGRAM = connection.vendor == 'postgresql'
    return _USE_TRIGRAM


def _top_trigram(qs, field, label_fn, sub_fn, type_str, screen, q):
    from django.contrib.postgres.search import TrigramSimilarity
    qs = qs.annotate(sim=TrigramSimilarity(field, q))
    results = []
    for obj in qs.filter(sim__gte=THRESHOLD).order_by('-sim')[:TOP_N]:
        results.append({
            'type': type_str,
            'id': obj.pk,
            'label': label_fn(obj),
            'sub': sub_fn(obj),
            'screen': screen,
            'link_id': obj.pk,
            '_sim': obj.sim,
        })
    return results


def _top_icontains(qs, field, label_fn, sub_fn, type_str, screen, q):
    results = []
    for obj in qs.filter(**{f'{field}__icontains': q})[:TOP_N]:
        results.append({
            'type': type_str,
            'id': obj.pk,
            'label': label_fn(obj),
            'sub': sub_fn(obj),
            'screen': screen,
            'link_id': obj.pk,
            '_sim': 1.0,
        })
    return results


def _top(qs, field, label_fn, sub_fn, type_str, screen, q):
    if _use_trigram():
        return _top_trigram(qs, field, label_fn, sub_fn, type_str, screen, q)
    return _top_icontains(qs, field, label_fn, sub_fn, type_str, screen, q)


class SearchView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        q = request.query_params.get('q', '').strip()
        if not q:
            return Response([])

        marina = request.user.marina
        if not marina:
            return Response([])

        results = []

        # Vessels
        from apps.vessels.models import Vessel
        results += _top(
            Vessel.objects.filter(marina=marina),
            'name', q=q,
            label_fn=lambda o: o.name,
            sub_fn=lambda o: f"{o.loa}m · {o.reg}" if o.loa else o.reg or '—',
            type_str='vessel', screen='vessels',
        )

        # Members
        from apps.members.models import Member
        results += _top(
            Member.objects.filter(marina=marina),
            'name', q=q,
            label_fn=lambda o: o.name,
            sub_fn=lambda o: o.email or '—',
            type_str='member', screen='members',
        )

        # Bookings
        from apps.reservations.models import Booking
        results += _top(
            Booking.objects.filter(marina=marina),
            'guest_name', q=q,
            label_fn=lambda o: o.vessel_name or o.guest_name or f'Booking #{o.pk}',
            sub_fn=lambda o: f"{o.check_in} – {o.check_out}",
            type_str='booking', screen='reservations',
        )

        # Invoices
        from apps.billing.models import Invoice
        results += _top(
            Invoice.objects.filter(marina=marina),
            'invoice_number', q=q,
            label_fn=lambda o: o.invoice_number,
            sub_fn=lambda o: f"€{o.total} · {o.status}",
            type_str='invoice', screen='billing',
        )

        # Staff (Users with role staff/manager/owner)
        from apps.accounts.models import User
        from django.db.models import Value, CharField
        from django.db.models.functions import Concat
        if _use_trigram():
            from django.contrib.postgres.search import TrigramSimilarity
            qs = User.objects.filter(marina=marina).exclude(role='boater').annotate(
                full_name=Concat('first_name', Value(' '), 'last_name', output_field=CharField()),
                sim=TrigramSimilarity(
                    Concat('first_name', Value(' '), 'last_name', output_field=CharField()), q
                )
            )
            for obj in qs.filter(sim__gte=THRESHOLD).order_by('-sim')[:TOP_N]:
                results.append({
                    'type': 'staff',
                    'id': obj.pk,
                    'label': f"{obj.first_name} {obj.last_name}".strip() or obj.email,
                    'sub': obj.role.capitalize(),
                    'screen': 'staff',
                    'link_id': obj.pk,
                    '_sim': obj.sim,
                })
        else:
            qs = User.objects.filter(marina=marina).exclude(role='boater').annotate(
                full_name=Concat('first_name', Value(' '), 'last_name', output_field=CharField()),
            ).filter(full_name__icontains=q)
            for obj in qs[:TOP_N]:
                results.append({
                    'type': 'staff',
                    'id': obj.pk,
                    'label': f"{obj.first_name} {obj.last_name}".strip() or obj.email,
                    'sub': obj.role.capitalize(),
                    'screen': 'staff',
                    'link_id': obj.pk,
                    '_sim': 1.0,
                })

        # Maintenance tasks
        from apps.maintenance.models import MaintenanceTask
        results += _top(
            MaintenanceTask.objects.filter(marina=marina),
            'title', q=q,
            label_fn=lambda o: o.title,
            sub_fn=lambda o: f"{o.priority} · {o.status}",
            type_str='maintenance_task', screen='maintenance',
        )

        # Sort all results by similarity descending, cap at 20
        results.sort(key=lambda x: x.get('_sim', 0), reverse=True)
        # Remove internal _sim key before returning
        for item in results:
            item.pop('_sim', None)
        return Response(results[:20])

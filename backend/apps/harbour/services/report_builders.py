"""
Harbour report builders.
All functions return plain Python lists/dicts — serialisation is done in views.
"""

from django.db import models

from apps.harbour.models import CommercialMovement


def vessel_traffic_report(marina, date_from, date_to) -> list:
    """
    All non-cancelled movements with ETA in [date_from, date_to].
    Used for port authority traffic submissions.
    """
    qs = (
        CommercialMovement.objects
        .filter(
            marina=marina,
            eta__date__gte=date_from,
            eta__date__lte=date_to,
        )
        .exclude(status='cancelled')
        .select_related('shipping_agent', 'berth_assigned')
        .order_by('eta')
    )
    return list(qs.values(
        'vessel_name', 'imo_number', 'flag', 'vessel_type', 'gross_tonnage',
        'net_tonnage', 'port_of_origin', 'next_port', 'eta', 'etd',
        'actual_arrival', 'actual_departure', 'crew_count', 'passenger_count',
        'cargo_type', 'cargo_weight_mt', 'status', 'psc_flag',
    ))


def daily_port_report(marina, date) -> list:
    """
    Vessels in port at midnight snapshot:
    ETA <= midnight(date) and (ETD > midnight(date) OR not yet departed).
    """
    from datetime import datetime, time
    import pytz

    snapshot = datetime.combine(date, time(0, 0), tzinfo=pytz.UTC)

    qs = (
        CommercialMovement.objects
        .filter(
            marina=marina,
            eta__lte=snapshot,
        )
        .filter(
            models.Q(etd__gt=snapshot) | models.Q(actual_departure__isnull=True)
        )
        .exclude(status__in=['cancelled', 'departed'])
        .select_related('berth_assigned', 'shipping_agent')
        .order_by('vessel_name')
    )
    return list(qs.values(
        'vessel_name', 'imo_number', 'flag', 'vessel_type', 'gross_tonnage',
        'status', 'berth_label', 'berth_assigned__name', 'shipping_agent__name',
        'crew_count', 'passenger_count',
    ))

"""
OFGEM CSV export service.

generate_ofgem_report(marina_id, date_from, date_to) -> bytes

Returns UTF-8 CSV bytes. Aggregates MeterReading rows by hour using
Django ORM Trunc. Columns follow the OFGEM half-hourly consumption format:
  device_id, berth_code, period_start, period_end,
  consumption_kwh, consumption_m3, unit

Note: period_end is set to period_start + 1 hour (change to 30 min if
OFGEM requires half-hourly granularity for your licence type).

View: OfgemReportView in views.py returns this as StreamingHttpResponse
with Content-Disposition: attachment; filename=ofgem_report.csv
"""

import csv
import io
import logging
from datetime import timedelta

from django.db.models import Sum
from django.db.models.functions import Trunc

logger = logging.getLogger(__name__)


def generate_ofgem_report(marina_id: int, date_from, date_to) -> bytes:
    """
    Returns UTF-8 CSV bytes. Aggregates MeterReading rows by hour.
    date_from / date_to: datetime.date objects (inclusive).
    """
    from apps.utilities.models import MeterReading

    rows = (
        MeterReading.objects
        .filter(
            meter__marina_id=marina_id,
            recorded_at__date__gte=date_from,
            recorded_at__date__lte=date_to,
        )
        .annotate(period=Trunc('recorded_at', 'hour'))
        .values('meter__device_id', 'meter__berth__code', 'period')
        .annotate(total_kwh=Sum('reading_kwh'), total_m3=Sum('reading_m3'))
        .order_by('meter__device_id', 'period')
    )

    buf = io.StringIO()
    writer = csv.DictWriter(
        buf,
        fieldnames=[
            'device_id', 'berth_code',
            'period_start', 'period_end',
            'consumption_kwh', 'consumption_m3', 'unit',
        ],
    )
    writer.writeheader()

    for row in rows:
        period_start = row['period']
        period_end   = period_start + timedelta(hours=1)
        kwh          = row['total_kwh']
        m3           = row['total_m3']

        writer.writerow({
            'device_id':       row['meter__device_id'],
            'berth_code':      row['meter__berth__code'] or '',
            'period_start':    period_start.isoformat(),
            'period_end':      period_end.isoformat(),
            'consumption_kwh': kwh if kwh is not None else '',
            'consumption_m3':  m3  if m3  is not None else '',
            'unit':            'kWh' if kwh is not None else 'm3',
        })

    logger.info(
        'OFGEM report generated: marina=%s from=%s to=%s',
        marina_id, date_from, date_to,
    )
    return buf.getvalue().encode('utf-8')

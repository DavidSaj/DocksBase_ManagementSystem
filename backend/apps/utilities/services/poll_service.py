"""
Smart meter polling service.

Entry point: poll_all_meters(marina_id)
  - Groups active SmartMeter records by vendor
  - Bulk-fetches readings via the vendor adapter
  - Saves MeterReading rows (bulk_create)
  - Updates SmartMeter.last_polled and is_online
  - Runs outage detection after each vendor batch

Called by: apps.utilities.tasks.poll_smart_meters (Celery)
Also callable directly from the management command for testing.
"""

import logging

from django.utils import timezone

from apps.utilities.vendors.base import VendorConnectionError, get_vendor_adapter

logger = logging.getLogger(__name__)


def poll_all_meters(marina_id: int) -> None:
    """
    Poll all active smart meters for a marina.
    Groups meters by vendor for efficient bulk API calls.
    Outage detection runs after every vendor batch.
    """
    from apps.utilities.models import SmartMeter
    from apps.utilities.services.outage_service import check_outages

    meters = SmartMeter.objects.filter(marina_id=marina_id, is_active=True).select_related('berth')
    if not meters.exists():
        logger.info('poll_all_meters: no active meters for marina %s', marina_id)
        return

    by_vendor: dict[str, list] = {}
    for m in meters:
        by_vendor.setdefault(m.vendor, []).append(m)

    now = timezone.now()

    for vendor_key, vendor_meters in by_vendor.items():
        try:
            adapter = get_vendor_adapter(vendor_key, marina_id)
        except Exception:
            logger.exception('Failed to get vendor adapter for vendor=%s marina=%s', vendor_key, marina_id)
            _flag_vendor_offline(vendor_meters)
            continue

        device_ids = [m.device_id for m in vendor_meters]
        try:
            readings = adapter.fetch_readings_bulk(device_ids)
        except VendorConnectionError:
            logger.warning('Vendor connection error for vendor=%s marina=%s', vendor_key, marina_id)
            _flag_vendor_offline(vendor_meters)
            continue
        except Exception:
            logger.exception('Unexpected error polling vendor=%s marina=%s', vendor_key, marina_id)
            _flag_vendor_offline(vendor_meters)
            continue

        _save_readings(readings, vendor_meters, now)
        logger.info(
            'Polled %d readings from vendor=%s marina=%s',
            len(readings), vendor_key, marina_id,
        )

    check_outages(marina_id)


def _flag_vendor_offline(vendor_meters: list) -> None:
    """Mark all meters for a failed vendor batch as offline."""
    from apps.utilities.models import SmartMeter
    pks = [m.pk for m in vendor_meters]
    SmartMeter.objects.filter(pk__in=pks).update(is_online=False)


def _save_readings(readings, meter_map_list, polled_at) -> None:
    """Bulk-insert MeterReading rows and update SmartMeter.last_polled."""
    from apps.utilities.models import MeterReading, SmartMeter

    meter_by_device = {m.device_id: m for m in meter_map_list}
    to_create = []
    to_update_pks = []

    for r in readings:
        meter = meter_by_device.get(r.device_id)
        if not meter:
            logger.warning('Received reading for unknown device_id=%s — skipping', r.device_id)
            continue
        to_create.append(MeterReading(
            meter=meter,
            reading_kwh=r.cumulative_kwh,
            reading_m3=r.cumulative_m3,
            recorded_at=r.recorded_at,
            source='auto',
        ))
        to_update_pks.append(meter.pk)

    if to_create:
        MeterReading.objects.bulk_create(to_create)
    if to_update_pks:
        SmartMeter.objects.filter(pk__in=to_update_pks).update(last_polled=polled_at, is_online=True)

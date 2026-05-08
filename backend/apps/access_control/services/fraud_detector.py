"""
apps/access_control/services/fraud_detector.py

Fraud anomaly detection rules.

Three rules:
  1. Repeated discounts by same staff member in 24h window.
  2. Large write-off by non-manager.
  3. Sales timestamped during after-hours window.

Thresholds are read from marina.features (seeded by migration 0002):
  - fraud_discount_count_threshold:    3
  - fraud_writeoff_threshold_amount:   200.00
  - fraud_after_hours_start:           "22:00"
  - fraud_after_hours_end:             "06:00"

All alert creation is idempotent — checks for existing unresolved duplicate first.
"""

import logging
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

logger = logging.getLogger(__name__)


def detect_fraud_for_marina(marina) -> list:
    """
    Run all three fraud detection rules for a marina.
    Returns list of FraudAnomalyAlert instances created (may be empty).
    """
    from apps.access_control.models import FraudAnomalyAlert, SpendAuthorisationRequest

    created_alerts = []
    now = timezone.now()
    window_start = now - timedelta(hours=24)

    discount_threshold = marina.features.get('fraud_discount_count_threshold', 3)
    writeoff_threshold = Decimal(str(marina.features.get('fraud_writeoff_threshold_amount', '200.00')))
    after_hours_start  = marina.features.get('fraud_after_hours_start', '22:00')
    after_hours_end    = marina.features.get('fraud_after_hours_end', '06:00')

    # -----------------------------------------------------------------------
    # Rule 1: Repeated discounts by staff in 24h window
    # -----------------------------------------------------------------------
    from django.db.models import Count
    staff_discount_counts = (
        SpendAuthorisationRequest.objects.filter(
            marina=marina,
            action_type='discount',
            requested_at__gte=window_start,
        )
        .values('requested_by')
        .annotate(cnt=Count('id'))
        .filter(cnt__gt=discount_threshold)
    )

    for row in staff_discount_counts:
        staff_id = row['requested_by']
        count    = row['cnt']
        already_exists = FraudAnomalyAlert.objects.filter(
            marina=marina,
            alert_type='repeated_discount',
            staff_member_id=staff_id,
            resolved_at__isnull=True,
            period_start__gte=window_start,
        ).exists()
        if not already_exists:
            alert = FraudAnomalyAlert.objects.create(
                marina=marina,
                alert_type='repeated_discount',
                staff_member_id=staff_id,
                period_start=window_start,
                period_end=now,
                event_count=count,
            )
            created_alerts.append(alert)
            logger.warning("FraudAnomalyAlert created: repeated_discount marina=%s staff=%s count=%d", marina.pk, staff_id, count)

    # -----------------------------------------------------------------------
    # Rule 2: Large write-offs by non-manager
    # -----------------------------------------------------------------------
    large_writeoffs = SpendAuthorisationRequest.objects.filter(
        marina=marina,
        action_type='write_off',
        amount__gt=writeoff_threshold,
        requested_at__gte=window_start,
    ).select_related('requested_by')

    for req in large_writeoffs:
        # Non-manager check: staff_member.role field; skip if manager/owner
        staff = req.requested_by
        if staff and getattr(staff, 'role', 'staff') in ('manager', 'owner'):
            continue
        already_exists = FraudAnomalyAlert.objects.filter(
            marina=marina,
            alert_type='large_write_off',
            staff_member=staff,
            resolved_at__isnull=True,
            period_start__gte=window_start,
        ).exists()
        if not already_exists:
            alert = FraudAnomalyAlert.objects.create(
                marina=marina,
                alert_type='large_write_off',
                staff_member=staff,
                period_start=window_start,
                period_end=now,
                event_count=1,
                total_amount=req.amount,
                threshold_exceeded=req.amount - writeoff_threshold,
            )
            created_alerts.append(alert)
            logger.warning("FraudAnomalyAlert created: large_write_off marina=%s staff=%s amount=%s", marina.pk, getattr(staff, 'pk', None), req.amount)

    # -----------------------------------------------------------------------
    # Rule 3: After-hours sales
    # -----------------------------------------------------------------------
    ah_start_h, ah_start_m = map(int, after_hours_start.split(':'))
    ah_end_h,   ah_end_m   = map(int, after_hours_end.split(':'))

    after_hours_requests = SpendAuthorisationRequest.objects.filter(
        marina=marina,
        requested_at__gte=window_start,
    )

    for req in after_hours_requests:
        local_time = timezone.localtime(req.requested_at)
        hour, minute = local_time.hour, local_time.minute
        t = hour * 60 + minute
        start_t = ah_start_h * 60 + ah_start_m
        end_t   = ah_end_h   * 60 + ah_end_m

        # After-hours window wraps midnight (e.g. 22:00 → 06:00)
        in_window = (t >= start_t) or (t <= end_t) if start_t > end_t else (start_t <= t <= end_t)
        if not in_window:
            continue
        already_exists = FraudAnomalyAlert.objects.filter(
            marina=marina,
            alert_type='after_hours_sale',
            staff_member=req.requested_by,
            resolved_at__isnull=True,
            period_start__gte=window_start,
        ).exists()
        if not already_exists:
            alert = FraudAnomalyAlert.objects.create(
                marina=marina,
                alert_type='after_hours_sale',
                staff_member=req.requested_by,
                period_start=window_start,
                period_end=now,
                event_count=1,
                total_amount=req.amount,
            )
            created_alerts.append(alert)
            logger.warning("FraudAnomalyAlert created: after_hours_sale marina=%s time=%s", marina.pk, local_time)

    return created_alerts

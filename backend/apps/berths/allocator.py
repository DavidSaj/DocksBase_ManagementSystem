from apps.reservations.booking_engine import ACTIVE_STATUSES


def run_smart_allocator(marina, freed_berth):
    """
    Called when a berth is freed. If auto_allocate_inventory is on,
    assigns freed_berth to mysea or direct based on current vs target split.
    Uses .update() to avoid triggering post_save signals (prevents loops).
    """
    if not marina.auto_allocate_inventory:
        return

    from apps.berths.models import Berth

    total_pool = (
        Berth.objects.filter(marina=marina)
        .exclude(status='maintenance')
        .count()
    )
    if total_pool == 0:
        return

    current_mysea = (
        Berth.objects.filter(marina=marina, sales_channel='mysea')
        .exclude(status='maintenance')
        .count()
    )
    target_mysea = round(total_pool * marina.mysea_target_pct / 100)

    new_channel = 'mysea' if current_mysea < target_mysea else 'direct'
    Berth.objects.filter(pk=freed_berth.pk).update(sales_channel=new_channel)


def rebalance_down(marina):
    """
    Called when mysea_target_pct is lowered. Immediately flips unoccupied
    mySea berths back to direct until the current count meets the new target.
    Berths with active bookings are never touched.
    """
    from apps.berths.models import Berth
    from apps.reservations.models import Booking

    total_pool = (
        Berth.objects.filter(marina=marina)
        .exclude(status='maintenance')
        .count()
    )
    if total_pool == 0:
        return

    target_mysea = round(total_pool * marina.mysea_target_pct / 100)

    occupied_berth_ids = (
        Booking.objects.filter(marina=marina, status__in=ACTIVE_STATUSES)
        .exclude(berth__isnull=True)
        .values_list('berth_id', flat=True)
        .distinct()
    )

    # Unoccupied mySea berths, ordered by code for deterministic behaviour
    candidates = (
        Berth.objects.filter(marina=marina, sales_channel='mysea')
        .exclude(status='maintenance')
        .exclude(pk__in=occupied_berth_ids)
        .order_by('code')
    )

    current_mysea = (
        Berth.objects.filter(marina=marina, sales_channel='mysea')
        .exclude(status='maintenance')
        .count()
    )

    to_flip = max(0, current_mysea - target_mysea)
    ids_to_flip = list(candidates.values_list('pk', flat=True)[:to_flip])
    if ids_to_flip:
        Berth.objects.filter(pk__in=ids_to_flip).update(sales_channel='direct')

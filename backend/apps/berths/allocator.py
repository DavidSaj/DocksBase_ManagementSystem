from apps.reservations.booking_engine import ACTIVE_STATUSES


def run_smart_allocator(marina, freed_berth):
    """
    Called when a berth is freed. Loops over all OTA connections for the marina,
    finds the one furthest below its target, and assigns the freed berth to it.
    If all connections are at/above target, sets berth to direct (ota_connection=None).
    Locked berths are never touched.
    Uses .update() to avoid triggering post_save signals (prevents loops).
    """
    if freed_berth.channel_locked:
        return

    from apps.berths.models import Berth, OTAConnection

    connections = list(OTAConnection.objects.filter(marina=marina))
    if not connections:
        return

    total_pool = (
        Berth.objects.filter(marina=marina)
        .exclude(status='maintenance')
        .count()
    )
    if total_pool == 0:
        return

    # Find connection with largest shortfall (current% - target%)
    best_conn = None
    best_shortfall = 0

    for conn in connections:
        current = (
            Berth.objects.filter(marina=marina, ota_connection=conn)
            .exclude(status='maintenance')
            .exclude(pk=freed_berth.pk)
            .count()
        )
        target = round(total_pool * _effective_target(conn, connections, total_pool) / 100)
        shortfall = target - current
        if shortfall > best_shortfall:
            best_shortfall = shortfall
            best_conn = conn

    Berth.objects.filter(pk=freed_berth.pk).update(
        ota_connection=best_conn  # None = direct if no shortfall
    )


def rebalance_down(connection):
    """
    Called when a connection's target_pct is lowered or the connection is deleted.
    Flips unlocked, unoccupied berths back to direct until the count meets the new target.
    """
    from apps.berths.models import Berth, OTAConnection
    from apps.reservations.models import Booking

    marina = connection.marina
    connections = list(OTAConnection.objects.filter(marina=marina))

    total_pool = (
        Berth.objects.filter(marina=marina)
        .exclude(status='maintenance')
        .count()
    )
    if total_pool == 0:
        return

    target = round(total_pool * _effective_target(connection, connections, total_pool) / 100)

    occupied_ids = (
        Booking.objects.filter(marina=marina, status__in=ACTIVE_STATUSES)
        .exclude(berth__isnull=True)
        .values_list('berth_id', flat=True)
        .distinct()
    )

    candidates = (
        Berth.objects.filter(marina=marina, ota_connection=connection)
        .exclude(status='maintenance')
        .exclude(pk__in=occupied_ids)
        .exclude(channel_locked=True)
        .order_by('code')
    )

    current = (
        Berth.objects.filter(marina=marina, ota_connection=connection)
        .exclude(status='maintenance')
        .count()
    )

    to_flip = max(0, current - target)
    ids_to_flip = list(candidates.values_list('pk', flat=True)[:to_flip])
    if ids_to_flip:
        Berth.objects.filter(pk__in=ids_to_flip).update(ota_connection=None)


def _effective_target(connection, all_connections, total_pool):
    """
    Returns the effective target_pct for a connection.
    If auto_allocate=True, divides remaining % evenly among all auto connections.
    """
    if not connection.auto_allocate:
        return connection.target_pct

    manual_total = sum(c.target_pct for c in all_connections if not c.auto_allocate)
    remaining = max(0, 100 - manual_total)
    auto_count = sum(1 for c in all_connections if c.auto_allocate)
    if auto_count == 0:
        return 0
    return round(remaining / auto_count)

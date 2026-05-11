from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver


# ── Vessel ─────────────────────────────────────────────────────────────────────

@receiver(post_save, sender='vessels.Vessel')
def index_vessel(sender, instance, **kwargs):
    from apps.search.index_helpers import upsert
    loa_str = f'{instance.loa}m · ' if getattr(instance, 'loa', None) else ''
    upsert(
        marina=instance.marina,
        target_model='vessel',
        target_id=instance.pk,
        search_text=instance.name,
        display_label=instance.name,
        display_sub=f'{loa_str}{instance.reg or "—"}',
        screen='vessels',
        link_id=instance.pk,
    )


@receiver(post_delete, sender='vessels.Vessel')
def deindex_vessel(sender, instance, **kwargs):
    from apps.search.index_helpers import remove
    remove('vessel', instance.pk)


# ── Member ─────────────────────────────────────────────────────────────────────

@receiver(post_save, sender='members.Member')
def index_member(sender, instance, **kwargs):
    from apps.search.index_helpers import upsert
    upsert(
        marina=instance.marina,
        target_model='member',
        target_id=instance.pk,
        search_text=instance.name,
        display_label=instance.name,
        display_sub=instance.email or '—',
        screen='members',
        link_id=instance.pk,
    )


@receiver(post_delete, sender='members.Member')
def deindex_member(sender, instance, **kwargs):
    from apps.search.index_helpers import remove
    remove('member', instance.pk)


# ── Booking ────────────────────────────────────────────────────────────────────

@receiver(post_save, sender='reservations.Booking')
def index_booking(sender, instance, **kwargs):
    from apps.search.index_helpers import upsert
    label = instance.vessel_name or instance.guest_name or f'Booking #{instance.pk}'
    search_text = instance.vessel_name or instance.guest_name or ''
    upsert(
        marina=instance.marina,
        target_model='booking',
        target_id=instance.pk,
        search_text=search_text,
        display_label=label,
        display_sub=f'{instance.check_in} – {instance.check_out}',
        screen='reservations',
        link_id=instance.pk,
    )


@receiver(post_delete, sender='reservations.Booking')
def deindex_booking(sender, instance, **kwargs):
    from apps.search.index_helpers import remove
    remove('booking', instance.pk)


# ── Invoice ────────────────────────────────────────────────────────────────────

@receiver(post_save, sender='billing.Invoice')
def index_invoice(sender, instance, **kwargs):
    from apps.search.index_helpers import upsert
    upsert(
        marina=instance.marina,
        target_model='invoice',
        target_id=instance.pk,
        search_text=instance.invoice_number,
        display_label=instance.invoice_number,
        display_sub=f'€{instance.total} · {instance.status}',
        screen='billing',
        link_id=instance.pk,
    )


@receiver(post_delete, sender='billing.Invoice')
def deindex_invoice(sender, instance, **kwargs):
    from apps.search.index_helpers import remove
    remove('invoice', instance.pk)


# ── MaintenanceTask ────────────────────────────────────────────────────────────

@receiver(post_save, sender='maintenance.MaintenanceTask')
def index_maintenance_task(sender, instance, **kwargs):
    from apps.search.index_helpers import upsert
    upsert(
        marina=instance.marina,
        target_model='maintenance_task',
        target_id=instance.pk,
        search_text=instance.title,
        display_label=instance.title[:100],
        display_sub=instance.priority,
        screen='maintenance',
        link_id=instance.pk,
    )


@receiver(post_delete, sender='maintenance.MaintenanceTask')
def deindex_maintenance_task(sender, instance, **kwargs):
    from apps.search.index_helpers import remove
    remove('maintenance_task', instance.pk)


# ── Berth ──────────────────────────────────────────────────────────────────────

@receiver(post_save, sender='berths.Berth')
def index_berth(sender, instance, **kwargs):
    from apps.search.index_helpers import upsert
    pier_code = instance.pier.code if instance.pier else ''
    upsert(
        marina=instance.marina,
        target_model='berth',
        target_id=instance.pk,
        search_text=instance.code,
        display_label=instance.code,
        display_sub=pier_code,
        screen='map',
        link_id=instance.pk,
    )


@receiver(post_delete, sender='berths.Berth')
def deindex_berth(sender, instance, **kwargs):
    from apps.search.index_helpers import remove
    remove('berth', instance.pk)

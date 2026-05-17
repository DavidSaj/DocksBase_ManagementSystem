from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver


def _join(*parts):
    """Null-safe space-joined concatenation for search_text."""
    return ' '.join(str(p) for p in parts if p)


# ── Vessel ─────────────────────────────────────────────────────────────────────

@receiver(post_save, sender='vessels.Vessel')
def index_vessel(sender, instance, **kwargs):
    from apps.search.index_helpers import upsert
    loa_str = f'{instance.loa}m · ' if getattr(instance, 'loa', None) else ''
    owner_name = instance.owner.name if instance.owner_id else ''
    search_text = _join(
        instance.name,
        instance.reg,
        owner_name,
        instance.vessel_type,
        instance.flag,
        instance.mmsi,
        instance.call_sign,
    )
    upsert(
        marina=instance.marina,
        target_model='vessel',
        target_id=instance.pk,
        search_text=search_text,
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
    search_text = _join(
        instance.name,
        instance.preferred_name,
        instance.email,
        instance.phone,
        instance.emergency_phone,
        instance.nationality,
        instance.address_country,
    )
    upsert(
        marina=instance.marina,
        target_model='member',
        target_id=instance.pk,
        search_text=search_text,
        display_label=instance.name,
        display_sub=instance.email or instance.phone or '—',
        screen='members',
        link_id=instance.pk,
    )

    # Re-index any vessels owned by this member so updates to email/phone/name
    # propagate into vessel search_text (owner.name is part of vessel index).
    try:
        for v in instance.vessels.all():
            index_vessel(sender=v.__class__, instance=v)
    except Exception:
        # Defensive: don't let cascade re-indexing break member save.
        pass


@receiver(post_delete, sender='members.Member')
def deindex_member(sender, instance, **kwargs):
    from apps.search.index_helpers import remove
    remove('member', instance.pk)


# ── Booking ────────────────────────────────────────────────────────────────────

@receiver(post_save, sender='reservations.Booking')
def index_booking(sender, instance, **kwargs):
    from apps.search.index_helpers import upsert
    label = instance.vessel_name or instance.guest_name or f'Booking #{instance.pk}'
    berth_code = instance.berth.code if instance.berth_id else ''
    vessel_obj_name = instance.vessel.name if instance.vessel_id else ''
    vessel_reg = instance.vessel.reg if instance.vessel_id else ''
    search_text = _join(
        f'BK{instance.pk}',
        instance.vessel_name,
        vessel_obj_name,
        vessel_reg,
        instance.guest_name,
        instance.guest_email,
        instance.guest_phone,
        berth_code,
    )
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
    member_name = instance.member.name if instance.member_id else ''
    member_email = instance.member.email if instance.member_id else ''
    search_text = _join(
        instance.invoice_number,
        member_name,
        member_email,
        str(instance.total) if instance.total is not None else '',
        instance.status,
    )
    upsert(
        marina=instance.marina,
        target_model='invoice',
        target_id=instance.pk,
        search_text=search_text,
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
    asset_name = ''
    try:
        if instance.asset_id and instance.asset is not None:
            asset_name = getattr(instance.asset, 'name', '') or str(instance.asset)
    except Exception:
        asset_name = ''
    search_text = _join(
        instance.title,
        instance.description,
        instance.assigned_to,
        instance.priority,
        instance.status,
        asset_name,
    )
    upsert(
        marina=instance.marina,
        target_model='maintenance_task',
        target_id=instance.pk,
        search_text=search_text,
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
    pier_code = ''
    pier_label = ''
    if instance.pier_id and instance.pier is not None:
        pier_code = instance.pier.code or ''
        pier_label = getattr(instance.pier, 'label', '') or ''
    current_vessel_name = ''
    current_vessel_reg = ''
    if instance.vessel_id and instance.vessel is not None:
        current_vessel_name = instance.vessel.name or ''
        current_vessel_reg = instance.vessel.reg or ''
    search_text = _join(
        instance.code,
        pier_code,
        pier_label,
        instance.pier_label,
        current_vessel_name,
        current_vessel_reg,
        instance.berth_type,
        instance.status,
    )
    upsert(
        marina=instance.marina,
        target_model='berth',
        target_id=instance.pk,
        search_text=search_text,
        display_label=instance.code,
        display_sub=pier_code,
        screen='map',
        link_id=instance.pk,
    )


@receiver(post_delete, sender='berths.Berth')
def deindex_berth(sender, instance, **kwargs):
    from apps.search.index_helpers import remove
    remove('berth', instance.pk)

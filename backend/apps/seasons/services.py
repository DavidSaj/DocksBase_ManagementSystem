"""
apps/seasons/services.py — business-logic facade for the seasonal-berth
domain.  Models are dumb storage; rules live here.

Scope: Phase 1 + 2 (spec §10).  Inventory bridge (Phase 3), sublet flow
(Phase 4) and frontend UI (Phase 5) are intentionally absent — placeholder
hooks in ``compute_sublet_split`` and ``berth_lease_inventory_filter`` are
documented in the spec but **not** implemented here.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from datetime import date, timedelta
from typing import Optional

from django.db import transaction
from django.utils import timezone

from .models import (
    BerthLease,
    InstalmentPlan,
    LEASE_LIVE_STATUSES,
    LeaseInstalment,
    LeaseVesselChangeEvent,
    Season,
    SeasonalRateCard,
)
from .signals import lease_access_revoked, lease_status_changed


# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------

# (from_status, to_status) tuples that are allowed.  Anything outside this
# set raises InvalidLeaseTransition.
_ALLOWED_TRANSITIONS = {
    ('offered',      'accepted'),
    ('offered',      'cancelled'),
    ('offered',      'deposit_paid'),   # marinas without an "accepted" gate
    ('accepted',     'deposit_paid'),
    ('accepted',     'cancelled'),
    ('deposit_paid', 'active'),
    ('deposit_paid', 'cancelled'),
    ('deposit_paid', 'defaulted'),
    ('active',       'ending'),
    ('active',       'defaulted'),
    ('active',       'cancelled'),
    ('ending',       'ended'),
    ('ending',       'renewed'),
    ('ending',       'defaulted'),
    ('ending',       'cancelled'),
}


class InvalidLeaseTransition(Exception):
    pass


# Statuses that fire the access-revoke signal (spec §9.11).
_ACCESS_REVOKE_STATUSES = {'cancelled', 'defaulted'}


def transition_lease(lease: BerthLease, new_status: str, *, by=None,
                     reason: str = '') -> BerthLease:
    """Move ``lease`` to ``new_status`` if the transition is permitted.

    Side effects (executed inside one ``transaction.atomic``):

    * ``status_changed_at`` stamped to ``now``.
    * On ``deposit_paid``: ``deposit_paid_at`` stamped; instalment schedule
      generated via :func:`generate_instalments` (idempotent).
    * On ``defaulted``: ``deposit_forfeited=True`` (spec §9.2).
    * On ``defaulted``/``cancelled``: ``lease_access_revoked`` signal fires
      after commit (spec §9.11).
    * ``lease_status_changed`` always fires.
    """
    old = lease.status
    if old == new_status:
        return lease
    if (old, new_status) not in _ALLOWED_TRANSITIONS:
        raise InvalidLeaseTransition(
            f'Cannot move lease #{lease.pk} from {old!r} to {new_status!r}.'
        )

    now = timezone.now()
    with transaction.atomic():
        lease.status = new_status
        lease.status_changed_at = now
        update_fields = ['status', 'status_changed_at', 'updated_at']

        if new_status == 'deposit_paid':
            if lease.deposit_paid_at is None:
                lease.deposit_paid_at = now
                update_fields.append('deposit_paid_at')

        if new_status == 'defaulted':
            lease.deposit_forfeited = True
            update_fields.append('deposit_forfeited')

        lease.save(update_fields=update_fields)

        # Side effects that themselves write rows (instalment schedule)
        # run inside the same atomic block.
        if new_status == 'deposit_paid':
            generate_instalments(lease)

        # Berth.owner / Berth.lease_expiry projection (spec §4.4).
        _project_to_berth(lease)

        # Signals — emit on_commit so rollback can't fire phantom revokes.
        def _emit():
            lease_status_changed.send(
                sender=BerthLease, lease=lease,
                old_status=old, new_status=new_status,
            )
            if new_status in _ACCESS_REVOKE_STATUSES:
                lease_access_revoked.send(
                    sender=BerthLease, lease=lease, reason=old,
                )

        transaction.on_commit(_emit)
    return lease


def _project_to_berth(lease: BerthLease) -> None:
    """Maintain the denormalised ``Berth.owner`` / ``Berth.lease_expiry``
    fields (spec §4.4).  Phase 6 renames ``owner`` → ``current_lease_holder``
    — keep this confined here so the future rename touches one helper.
    """
    berth = lease.berth
    if lease.status == 'active':
        berth.owner = lease.member
        berth.lease_expiry = lease.end_date
        berth.save(update_fields=['owner', 'lease_expiry'])
    elif lease.status in ('cancelled', 'defaulted', 'ended'):
        # Only clear if THIS lease is the currently projected one.
        if berth.owner_id == lease.member_id and berth.lease_expiry == lease.end_date:
            berth.owner = None
            berth.lease_expiry = None
            berth.save(update_fields=['owner', 'lease_expiry'])


# ---------------------------------------------------------------------------
# Pricing — mid-season pro-ration (spec §6.1, locked decision §9.6).
# ---------------------------------------------------------------------------

@dataclass
class ProratedTotals:
    season_total: Decimal
    deposit_amount: Decimal


def prorate_for_mid_start(
    *, rate_card: SeasonalRateCard, season: Season,
    lease_start: date, lease_end: date,
    charge_full_season_on_mid_start: bool = False,
) -> ProratedTotals:
    """Return the (season_total, deposit) to snapshot onto a new lease.

    Pro-ration policy (locked decision §9.6): by remaining calendar days by
    default; full price if the marina flag is set.  Deposit is never
    pro-rated — it's a fixed liquidation-damages floor (locked decision §9.2).
    """
    full_total = Decimal(rate_card.season_total)
    deposit = Decimal(rate_card.deposit_amount or 0)

    if charge_full_season_on_mid_start:
        return ProratedTotals(full_total, deposit)

    season_days = (season.end_date - season.start_date).days + 1
    lease_days = (lease_end - lease_start).days + 1
    if lease_days >= season_days:
        return ProratedTotals(full_total, deposit)
    if season_days <= 0:
        return ProratedTotals(full_total, deposit)

    ratio = Decimal(lease_days) / Decimal(season_days)
    prorated = (full_total * ratio).quantize(Decimal('0.01'),
                                             rounding=ROUND_HALF_UP)
    return ProratedTotals(prorated, deposit)


# ---------------------------------------------------------------------------
# Lease creation
# ---------------------------------------------------------------------------

def create_lease(
    *,
    member, berth, season: Season,
    rate_card: Optional[SeasonalRateCard] = None,
    instalment_plan: Optional[InstalmentPlan] = None,
    vessel=None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    tax_exempt_override: Optional[bool] = None,
    auto_renewal_enabled: Optional[bool] = None,
    source: str = 'manual',
    waitlist_offer=None,
    created_by=None,
    notes: str = '',
) -> BerthLease:
    """Create a BerthLease, snapshotting price+deposit from the rate card.

    Enforces the application-level no-overlap rule for berths (spec §7.3):
    raises ``OverlappingLeaseError`` if a live lease already covers any day
    of the requested window.  The Postgres GIST exclusion constraint is the
    DB-level back-stop; this check gives a friendly error on every backend
    (SQLite in tests, Postgres in prod).
    """
    start_date = start_date or season.start_date
    end_date = end_date or season.end_date

    # Tax-exempt inheritance (spec §9.12): default from Season unless caller
    # overrides explicitly.
    if tax_exempt_override is None:
        tax_exempt_override = season.is_tax_exempt_default

    if auto_renewal_enabled is None:
        auto_renewal_enabled = season.auto_renewal_enabled

    marina = season.marina

    # Snapshot price.  If a rate card is supplied, use it (potentially
    # pro-rated for mid-season starts).  Otherwise allow caller to specify
    # season_total/deposit (used by migration and tests).
    if rate_card is not None:
        full_flag = getattr(marina, 'charge_full_season_on_mid_start', False)
        totals = prorate_for_mid_start(
            rate_card=rate_card, season=season,
            lease_start=start_date, lease_end=end_date,
            charge_full_season_on_mid_start=full_flag,
        )
        season_total = totals.season_total
        deposit_amount = totals.deposit_amount
    else:
        # Caller must provide season_total via notes-injected kwargs? No —
        # explicit positional args.  We require a rate card unless an
        # override path (legacy migration) provides season_total directly.
        season_total = Decimal('0.00')
        deposit_amount = Decimal('0.00')

    with transaction.atomic():
        _assert_no_overlap(berth=berth, start=start_date, end=end_date,
                           exclude_pk=None)
        lease = BerthLease.objects.create(
            marina=marina,
            berth=berth,
            member=member,
            vessel=vessel,
            season=season,
            rate_card=rate_card,
            season_total=season_total,
            deposit_amount=deposit_amount,
            start_date=start_date,
            end_date=end_date,
            status='offered',
            instalment_plan=instalment_plan,
            tax_exempt_override=tax_exempt_override,
            auto_renewal_enabled=auto_renewal_enabled,
            source=source,
            waitlist_offer=waitlist_offer,
            created_by=created_by,
            notes=notes,
        )
        return lease


class OverlappingLeaseError(Exception):
    """Raised when application-level pre-check finds an overlap.

    The PostgreSQL exclusion constraint also enforces this at the DB layer;
    this exception is the friendly error path used in services and the API.
    """


def _assert_no_overlap(*, berth, start, end, exclude_pk):
    qs = BerthLease.objects.filter(
        berth=berth, status__in=LEASE_LIVE_STATUSES,
    ).filter(
        start_date__lte=end, end_date__gte=start,
    )
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    if qs.exists():
        raise OverlappingLeaseError(
            f'Berth {berth.pk} already has a live lease overlapping '
            f'{start}–{end}.'
        )


# ---------------------------------------------------------------------------
# Instalment generation
# ---------------------------------------------------------------------------

def generate_instalments(lease: BerthLease) -> list[LeaseInstalment]:
    """Snapshot the plan onto LeaseInstalment rows.

    Idempotent — if rows already exist for this lease, they're left
    untouched.  Spec §4.5.  Stripe-checkout creation is left to the billing
    scheduler (Phase 2 also delivers ``mark_instalment_paid``).
    """
    if lease.instalments.exists():
        return list(lease.instalments.all())

    plan = lease.instalment_plan
    if plan is None or plan.instalment_count <= 0:
        return []

    count = plan.instalment_count
    base_amount = Decimal(lease.season_total) - Decimal(lease.deposit_amount or 0)
    if base_amount < 0:
        base_amount = Decimal('0.00')
    per = (base_amount / count).quantize(Decimal('0.01'),
                                         rounding=ROUND_HALF_UP)
    # Last instalment absorbs rounding drift.
    last = (base_amount - per * (count - 1)).quantize(Decimal('0.01'),
                                                       rounding=ROUND_HALF_UP)

    instalments = []
    for i in range(count):
        seq = i + 1
        amount = last if seq == count else per
        due = _due_date(plan, lease, seq)
        instalments.append(
            LeaseInstalment(
                lease=lease, sequence=seq, due_date=due,
                amount=amount, status='scheduled',
            )
        )
    LeaseInstalment.objects.bulk_create(instalments)
    return list(lease.instalments.all())


def _due_date(plan: InstalmentPlan, lease: BerthLease, sequence: int) -> date:
    """Compute the due date for instalment #sequence (1-indexed)."""
    offset = plan.first_due_offset_days
    n = sequence - 1
    base = lease.start_date + timedelta(days=offset)
    if plan.frequency == 'lump_sum':
        return base
    if plan.frequency == 'monthly':
        return _add_months(base, n)
    if plan.frequency == 'quarterly':
        return _add_months(base, n * 3)
    # 'custom' — caller is expected to back-fill due_dates manually after
    # generate_instalments returns.
    return base


def _add_months(d: date, months: int) -> date:
    """Add ``months`` calendar months to ``d`` clamping the day."""
    if months == 0:
        return d
    year = d.year + (d.month - 1 + months) // 12
    month = (d.month - 1 + months) % 12 + 1
    # clamp to last day of target month
    from calendar import monthrange
    day = min(d.day, monthrange(year, month)[1])
    return date(year, month, day)


# ---------------------------------------------------------------------------
# Invoicing — invoice-per-instalment (locked decision: Option A)
# ---------------------------------------------------------------------------

def issue_instalment_invoice(instalment: LeaseInstalment):
    """Create + finalize a billing.Invoice for this instalment.

    Idempotent: if the instalment already has an invoice, return it.
    Returns the Invoice (status='open' after finalize).
    """
    from apps.billing import service as billing_service

    if instalment.invoice_id:
        return instalment.invoice

    lease = instalment.lease
    with transaction.atomic():
        invoice = billing_service.create_invoice(
            marina=lease.marina, member=lease.member,
            source_type='lease_instalment', source_id=str(instalment.pk),
            due_date=instalment.due_date,
            billing_period=instalment.due_date.strftime('%Y-%m'),
        )
        # Tax precedence (spec §3.4): lease override wins, then member.
        tax_rate = _resolve_lease_tax_rate(lease)
        billing_service.add_line_item(
            invoice=invoice,
            description=(
                f'Lease #{lease.pk} instalment {instalment.sequence}/'
                f'{lease.instalments.count()} — {lease.season.name}'
            ),
            quantity=1,
            unit_price=instalment.amount,
            tax_rate=tax_rate,
        )
        billing_service.finalize_invoice(invoice)

        instalment.invoice = invoice
        instalment.status = 'invoiced'
        instalment.issued_at = timezone.now()
        instalment.save(update_fields=['invoice', 'status', 'issued_at'])
    return invoice


def issue_deposit_invoice(lease: BerthLease):
    """Create+finalize the deposit invoice for a lease.

    Returns the Invoice.  Used by the manager wizard when a lease is in
    ``offered`` or ``accepted`` state and we need a payable link to send.
    """
    from apps.billing import service as billing_service

    if Decimal(lease.deposit_amount or 0) <= 0:
        raise ValueError(
            f'Lease #{lease.pk} has no deposit configured.'
        )
    with transaction.atomic():
        invoice = billing_service.create_invoice(
            marina=lease.marina, member=lease.member,
            source_type='lease_deposit', source_id=str(lease.pk),
            due_date=lease.start_date,
            billing_period=lease.start_date.strftime('%Y-%m'),
        )
        billing_service.add_line_item(
            invoice=invoice,
            description=f'Lease #{lease.pk} deposit — {lease.season.name}',
            quantity=1,
            unit_price=Decimal(lease.deposit_amount),
            tax_rate=_resolve_lease_tax_rate(lease),
        )
        billing_service.finalize_invoice(invoice)
    return invoice


def _resolve_lease_tax_rate(lease: BerthLease) -> Decimal:
    if lease.tax_exempt_override:
        return Decimal('0.00')
    if lease.member and getattr(lease.member, 'tax_exempt', False):
        return Decimal('0.00')
    # Rate-card-supplied tax rate if available.
    if lease.rate_card and lease.rate_card.tax_rate:
        return Decimal(lease.rate_card.tax_rate.rate)
    return Decimal('0.00')


def mark_deposit_paid(lease: BerthLease, *, by=None):
    """Convenience wrapper: transitions to deposit_paid (the heavy lifting
    — instalment generation, Berth.owner projection, signals — is inside
    :func:`transition_lease`)."""
    return transition_lease(lease, 'deposit_paid', by=by)


def mark_instalment_paid(instalment: LeaseInstalment, *, method='cash',
                         recorded_by=None):
    """Mark an instalment as paid via existing billing service.

    If the instalment has not yet been invoiced, an invoice is issued first.
    Re-uses :func:`apps.billing.service.mark_paid_manual`.
    """
    from apps.billing import service as billing_service
    if instalment.invoice_id is None:
        issue_instalment_invoice(instalment)
        instalment.refresh_from_db()

    with transaction.atomic():
        billing_service.mark_paid_manual(
            instalment.invoice, method=method, recorded_by=recorded_by,
        )
        instalment.status = 'paid'
        instalment.paid_at = timezone.now()
        instalment.save(update_fields=['status', 'paid_at'])
    return instalment


# ---------------------------------------------------------------------------
# Vessel-swap audit (spec §9.9 locked decision)
# ---------------------------------------------------------------------------

def change_lease_vessel(lease: BerthLease, *, new_vessel,
                        changed_by=None, reason: str = ''):
    """Swap the vessel on a lease and record an audit row.  No money moves."""
    old = lease.vessel
    if old == new_vessel:
        return lease
    with transaction.atomic():
        LeaseVesselChangeEvent.objects.create(
            lease=lease, from_vessel=old, to_vessel=new_vessel,
            changed_by=changed_by, reason=reason,
        )
        lease.vessel = new_vessel
        lease.save(update_fields=['vessel', 'updated_at'])
    return lease


# ---------------------------------------------------------------------------
# Phase 3/4 hooks — intentionally NOT implemented (TODO markers).
# ---------------------------------------------------------------------------

def berth_lease_inventory_filter(qs, ci, co):
    """Phase 3 — delegates to :func:`apps.berths.availability.berth_lease_inventory_filter`.

    The real implementation lives next to the other availability helpers in
    ``apps/berths/availability.py`` (spec §4.2 — single source of truth so
    the legacy allocator and the smart scorer cannot drift). This shim is
    kept so any external caller importing from ``apps.seasons.services``
    continues to work.
    """
    from apps.berths.availability import berth_lease_inventory_filter as _impl
    return _impl(qs, ci, co)


def compute_sublet_split(member, marina, departure):
    """TODO Phase 4 — implement the pro-rated-credit policy (locked
    decision §9.3): marina retains 100% of guest payment; holder receives
    an account credit equal to N nights × (season_total / season_days).
    """
    raise NotImplementedError(
        'Sublet split is Phase 4 — see spec §5.3 and apps/seasons/services.py.'
    )

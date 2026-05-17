"""
apps/seasons/models.py — Seasonal-berth tenancy domain (Phase 1+2).

See docs/superpowers/specs/2026-05-17-seasonal-berths-design.md for the
full design. This module implements:

    * Season              — marina-defined trading period
    * SeasonalRateCard    — the product (price band × season)
    * InstalmentPlan      — schedule definition
    * BerthLease          — tenancy of a Berth for a Season (state machine)
    * LeaseInstalment     — one scheduled instalment, optionally linked to an Invoice
    * LeaseVesselChangeEvent — audit row for §6.2 vessel swaps

User decisions locked from spec §9:
    1.  Deposit non-refundable; instalments refundable only for whole unused
        future months with 30-day notice (policy lives in service layer).
    2.  Day-0 / +14 / +30 default timeline; deposit forfeited on `defaulted`.
    3.  Sublet revenue: pro-rated lease credit (Phase 4 — hooks only here).
    4.  Renewal: manual default; auto-renewal opt-in per lease.
    5.  Overlapping seasons allowed; unique constraint is on lease, not season.
    6.  Mid-season pro-ration by remaining days, overridable via
        ``Marina.charge_full_season_on_mid_start``.
    7.  ``Berth.owner`` kept; rename deferred to Phase 6.
    8.  Annual berthing → ``season_type='annual'``.
    9.  Single ``vessel_id`` v1; mid-season swap → LeaseVesselChangeEvent row.
    11. Default/cancel transitions emit ``lease_access_revoked`` signal.
    12. ``Season.is_tax_exempt_default`` for jurisdictions that zero-rate
        long leases.
"""
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone


# ---------------------------------------------------------------------------
# Choice enumerations (module-level for easy imports in services / tests).
# ---------------------------------------------------------------------------

SEASON_TYPE_CHOICES = [
    ('summer', 'Summer'),
    ('winter', 'Winter'),
    ('annual', 'Annual'),
    ('custom', 'Custom'),
]

INSTALMENT_FREQUENCY_CHOICES = [
    ('lump_sum',  'Lump Sum'),
    ('monthly',   'Monthly'),
    ('quarterly', 'Quarterly'),
    ('custom',    'Custom'),
]

# BerthLease state machine — see spec §4.3.
LEASE_STATUS_CHOICES = [
    ('offered',      'Offered'),
    ('accepted',     'Accepted'),
    ('deposit_paid', 'Deposit Paid'),
    ('active',       'Active'),
    ('ending',       'Ending'),
    ('ended',        'Ended'),
    ('renewed',      'Renewed'),
    ('cancelled',    'Cancelled'),
    ('defaulted',    'Defaulted'),
]

# Statuses that count as "live" — they exclude inventory and forbid a second
# overlapping lease on the same berth.  ``ended``/``renewed`` are historical;
# ``cancelled``/``defaulted`` are terminated; everything else is live.
LEASE_LIVE_STATUSES = (
    'offered', 'accepted', 'deposit_paid', 'active', 'ending',
)

LEASE_RENEWAL_RESPONSE_CHOICES = [
    ('pending',     'Pending'),
    ('accepted',    'Accepted'),
    ('declined',    'Declined'),
    ('no_response', 'No Response'),
]

LEASE_SOURCE_CHOICES = [
    ('manual',          'Manual'),
    ('waitlist_offer',  'Waitlist Offer'),
    ('renewal',         'Renewal'),
    ('migrated_legacy', 'Migrated From Legacy Booking'),
]

LEASE_INSTALMENT_STATUS_CHOICES = [
    ('scheduled', 'Scheduled'),
    ('invoiced',  'Invoiced'),
    ('paid',      'Paid'),
    ('overdue',   'Overdue'),
    ('waived',    'Waived'),
]


# ---------------------------------------------------------------------------
# Season
# ---------------------------------------------------------------------------

class Season(models.Model):
    """Marina-defined trading period.  See spec §2."""

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='seasons',
    )
    name = models.CharField(max_length=100)
    season_type = models.CharField(
        max_length=20, choices=SEASON_TYPE_CHOICES, default='summer',
    )
    start_date = models.DateField()
    end_date = models.DateField()
    is_default_for_new_leases = models.BooleanField(default=False)
    default_rate_card = models.ForeignKey(
        'seasons.SeasonalRateCard', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='default_for_seasons',
    )
    default_instalment_plan = models.ForeignKey(
        'seasons.InstalmentPlan', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='default_for_seasons',
    )
    auto_renewal_enabled = models.BooleanField(default=False)
    waitlist_drain_priority = models.IntegerField(default=0)
    is_tax_exempt_default = models.BooleanField(
        default=False,
        help_text=(
            'Spec §9.12 — jurisdictions that zero-rate long leases. '
            'Leases inherit this at creation time via tax_exempt_override.'
        ),
    )
    is_archived = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-start_date', 'name']
        constraints = [
            models.UniqueConstraint(
                fields=['marina', 'name'], name='season_unique_name_per_marina',
            ),
            models.CheckConstraint(
                condition=models.Q(start_date__lt=models.F('end_date')),
                name='season_start_before_end',
            ),
        ]

    def __str__(self):
        return f'{self.name} ({self.marina_id})'

    @property
    def total_days(self):
        return (self.end_date - self.start_date).days + 1


# ---------------------------------------------------------------------------
# SeasonalRateCard
# ---------------------------------------------------------------------------

class SeasonalRateCard(models.Model):
    """Price band for one Season.  See spec §3.1."""

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='rate_cards',
    )
    season = models.ForeignKey(
        Season, on_delete=models.CASCADE, related_name='rate_cards',
    )
    name = models.CharField(max_length=120)
    min_length_m = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True,
    )
    max_length_m = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True,
    )
    berth_category = models.ForeignKey(
        'berths.BerthCategory', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='rate_cards',
    )
    season_total = models.DecimalField(max_digits=10, decimal_places=2)
    deposit_amount = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal('0.00'),
    )
    tax_rate = models.ForeignKey(
        'billing.TaxRate', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='rate_cards',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['season', 'name']

    def __str__(self):
        return f'{self.name} — €{self.season_total}'


# ---------------------------------------------------------------------------
# InstalmentPlan
# ---------------------------------------------------------------------------

class InstalmentPlan(models.Model):
    """Schedule template snapshotted onto a BerthLease.  See spec §3.2."""

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE,
        related_name='instalment_plans',
    )
    name = models.CharField(max_length=100)
    frequency = models.CharField(
        max_length=20, choices=INSTALMENT_FREQUENCY_CHOICES, default='monthly',
    )
    instalment_count = models.PositiveIntegerField(default=1)
    first_due_offset_days = models.IntegerField(
        default=0,
        help_text='Days after lease.start_date until instalment #1 falls due.',
    )
    deposit_first = models.BooleanField(
        default=True,
        help_text='If True, the deposit is a separate first invoice.',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['marina', 'name']

    def __str__(self):
        return f'{self.name} ({self.frequency} ×{self.instalment_count})'


# ---------------------------------------------------------------------------
# BerthLease
# ---------------------------------------------------------------------------

class BerthLease(models.Model):
    """A tenancy contract: one Member, one Berth, one Season.

    See spec §4.  State machine implemented via :py:meth:`transition_to`
    and the helpers in :py:mod:`apps.seasons.services`.
    """

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='leases',
    )
    berth = models.ForeignKey(
        'berths.Berth', on_delete=models.PROTECT, related_name='leases',
    )
    member = models.ForeignKey(
        'members.Member', on_delete=models.PROTECT, related_name='leases',
    )
    vessel = models.ForeignKey(
        'vessels.Vessel', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='leases',
    )
    season = models.ForeignKey(
        Season, on_delete=models.PROTECT, related_name='leases',
    )

    # Snapshots from rate card (spec §4.1 — post-signature edits must not
    # rewrite history).
    rate_card = models.ForeignKey(
        SeasonalRateCard, on_delete=models.PROTECT,
        null=True, blank=True, related_name='leases',
    )
    season_total = models.DecimalField(max_digits=10, decimal_places=2)
    deposit_amount = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal('0.00'),
    )

    start_date = models.DateField()
    end_date = models.DateField()

    status = models.CharField(
        max_length=20, choices=LEASE_STATUS_CHOICES, default='offered',
    )
    status_changed_at = models.DateTimeField(default=timezone.now)
    at_risk = models.BooleanField(
        default=False,
        help_text='Spec §6.3 — flagged at Day+14 of missed instalment.',
    )

    # Deposit lifecycle.
    deposit_paid_at = models.DateTimeField(null=True, blank=True)
    deposit_forfeited = models.BooleanField(
        default=False,
        help_text='Spec §9.2 — deposit auto-forfeited on default transition.',
    )

    # Renewal chain.
    prior_lease = models.ForeignKey(
        'self', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='renewals',
    )
    renewal_offered_at = models.DateTimeField(null=True, blank=True)
    renewal_response = models.CharField(
        max_length=20, choices=LEASE_RENEWAL_RESPONSE_CHOICES,
        default='pending',
    )
    auto_renewal_enabled = models.BooleanField(default=False)

    instalment_plan = models.ForeignKey(
        InstalmentPlan, on_delete=models.PROTECT,
        null=True, blank=True, related_name='leases',
    )
    tax_exempt_override = models.BooleanField(default=False)

    source = models.CharField(
        max_length=30, choices=LEASE_SOURCE_CHOICES, default='manual',
    )
    waitlist_offer = models.ForeignKey(
        'waitlist.WaitlistOffer', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='leases',
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='created_leases',
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-start_date', 'berth__code']
        constraints = [
            models.UniqueConstraint(
                fields=['berth', 'season'],
                name='lease_unique_berth_per_season',
            ),
            models.CheckConstraint(
                condition=models.Q(start_date__lt=models.F('end_date')),
                name='lease_start_before_end',
            ),
        ]
        indexes = [
            models.Index(fields=['berth', 'start_date', 'end_date']),
            models.Index(fields=['member', 'status']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return (
            f'Lease #{self.pk} {self.member_id}@{self.berth_id} '
            f'{self.start_date}–{self.end_date} [{self.status}]'
        )

    # ------------------------------------------------------------------
    # State-machine helpers — full transition logic in services.py.
    # ------------------------------------------------------------------
    @property
    def is_live(self):
        return self.status in LEASE_LIVE_STATUSES

    def overlaps(self, ci, co):
        """True if this lease's [start, end] (inclusive) overlaps [ci, co).

        Caller side is half-open ([ci, co)) which is the Tetris convention
        (see spec §2.4).
        """
        return (self.start_date < co) and (ci <= self.end_date)


# ---------------------------------------------------------------------------
# LeaseInstalment
# ---------------------------------------------------------------------------

class LeaseInstalment(models.Model):
    lease = models.ForeignKey(
        BerthLease, on_delete=models.CASCADE, related_name='instalments',
    )
    sequence = models.PositiveIntegerField()
    due_date = models.DateField()
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    invoice = models.ForeignKey(
        'billing.Invoice', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='lease_instalments',
    )
    status = models.CharField(
        max_length=20, choices=LEASE_INSTALMENT_STATUS_CHOICES,
        default='scheduled',
    )
    issued_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['lease', 'sequence']
        constraints = [
            models.UniqueConstraint(
                fields=['lease', 'sequence'],
                name='lease_instalment_unique_sequence',
            ),
        ]

    def __str__(self):
        return (
            f'Instalment {self.sequence} of lease #{self.lease_id} '
            f'due {self.due_date} (€{self.amount}, {self.status})'
        )


# ---------------------------------------------------------------------------
# LeaseVesselChangeEvent (spec §9.9 — audit row for mid-season vessel swap)
# ---------------------------------------------------------------------------

class LeaseVesselChangeEvent(models.Model):
    lease = models.ForeignKey(
        BerthLease, on_delete=models.CASCADE, related_name='vessel_changes',
    )
    from_vessel = models.ForeignKey(
        'vessels.Vessel', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='left_lease_events',
    )
    to_vessel = models.ForeignKey(
        'vessels.Vessel', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='entered_lease_events',
    )
    changed_at = models.DateTimeField(default=timezone.now)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='lease_vessel_changes',
    )
    reason = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ['-changed_at']

    def __str__(self):
        return f'Vessel change on lease #{self.lease_id} @ {self.changed_at}'

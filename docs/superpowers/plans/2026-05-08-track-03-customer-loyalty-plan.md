# Track 3 — Customer Intelligence & Loyalty: Implementation Plan
Date: 2026-05-08
Spec: `docs/superpowers/specs/2026-05-07-track-03-customer-loyalty-design.md`

---

## Overview

Track 3 extends the existing `members` and `billing` apps and replaces/extends the partially-built `loyalty` app. The current `loyalty` app has a simplified tier model (hardcoded string choices), no `LoyaltyTier` model, no `PointsLedger`/`ReferralUse` spec models, and no management commands. This plan covers the delta: what must be rebuilt, what can be kept, and the exact order to execute it.

---

## Gap Analysis

### loyalty/models.py — must be replaced/extended

| Existing model | Spec model | Action |
|---|---|---|
| `LoyaltyMembership` | `LoyaltyMembership` | Rebuild — existing uses hardcoded `TIER_CHOICES` string; spec requires FK to `LoyaltyTier`. Add `lifetime_spend`, `qualifying_stays`, `tier_achieved_at`, `tier_expires_at`, `last_activity_at`. Drop `lifetime_points` (now computed from ledger). |
| `PointTransaction` | `PointsLedger` | Rebuild — rename, add `balance_after` (snapshot), `invoice` FK, `line_item` FK, `created_by` FK, change `reason` → `entry_type` choices to match spec. |
| `ReferralCode` | `ReferralCode` | Extend — add `referrer_benefit_type`, `referrer_benefit_value`, `referee_benefit_type`, `referee_benefit_value`. Remove `reward_points`, `referee_reward_points`, `uses_remaining`. |
| `ReferralConversion` | `ReferralUse` | Rebuild — rename, add `referee_booking` FK, `benefit_status`, `referrer_benefit_applied_at`, `referee_benefit_applied_at`. |
| `CouponCode` | `CouponCode` | Keep as-is — not in spec but is existing functioning code; keep it. |
| `MemberCreditAccount` | (moved to billing in Track 4) | Keep for now; Track 4 will supersede it. Do NOT delete in Track 3. |
| `CreditTransaction` | (moved to billing in Track 4) | Keep for now; Track 4 will supersede it. |
| **Missing** | `LoyaltyTier` | New model — marina-configurable tiers with threshold, discount pct, points multiplier, requalification policy. |

### loyalty/services.py — gaps

| Existing function | Status |
|---|---|
| `get_or_create_membership` | Keep, update signature to work with new model fields |
| `earn_points` | Rewrite — must accept `invoice`, write `PointsLedger` (not `PointTransaction`), update `last_activity_at`, call `evaluate_tier()` |
| `redeem_points` | Rewrite — must create negative `InvoiceLineItem` via loyalty `ChargeableItem`, write `PointsLedger` entry |
| `_maybe_upgrade_tier` | Replace with `evaluate_tier()` — must read from `LoyaltyTier` queryset, not hardcoded thresholds; handle `tier_achieved_at`, `tier_expires_at`, send congratulatory email |
| `apply_referral_code` | Rewrite — implement net-new customer gate, split referee discount (immediate) from referrer benefit (pending until €50 qualifying spend) |
| `apply_coupon` | Keep — minor fix: link `chargeable_item` on the created `InvoiceLineItem` |
| **Missing** | `apply_tier_discount(booking, invoice)` — called at booking finalisation |
| **Missing** | `calculate_points_earned(invoice, membership)` — formula: `int(invoice.total * marina.points_earn_rate * tier.points_multiplier)` |
| **Missing** | `get_or_create_loyalty_chargeable_item(marina, tier)` — find or create the template `ChargeableItem` for this tier's discount |
| **Missing** | `adjust_points_manual(membership, points, description, staff_member)` — staff manual adjustment, writes ADJUST ledger entry |

### loyalty/signals.py — gaps

| Existing signal | Status |
|---|---|
| `award_points_on_payment` (post_save Payment) | Rewrite — currently reads `marina.features` dict; must call `calculate_points_earned()` using `marina.points_earn_rate` and tier multiplier, then call `earn_points()` which now writes `PointsLedger` |
| **Missing** | Post-save `SurveyResponse` — if `nps_score <= 6` and `alert_sent=False`, send email to `marina.harbour_master_email`, set `alert_sent=True` |

### loyalty/views.py — gaps

| Existing endpoint | Status |
|---|---|
| `LoyaltyMembershipListView` | Keep, update serializer |
| `LoyaltyMembershipDetailView` | Keep, update serializer |
| `MemberPointTransactionsView` | Rename to `PointsLedgerView`, update model reference |
| `RedeemPointsView` | Rewrite — body must accept `{points, invoice_id}`, call new `redeem_points()` |
| `ReferralCodeListCreateView` | Keep, update serializer fields |
| `ReferralCodeDetailView` | Keep |
| `CouponCodeListCreateView` | Keep |
| `CouponCodeDetailView` | Keep |
| `ApplyCouponView` | Keep |
| `MemberCreditAccountView` | Keep (Track 4 supersedes) |
| `MemberCreditTransactionsView` | Keep (Track 4 supersedes) |
| `TopUpCreditView` | Keep (Track 4 supersedes) |
| **Missing** | `LoyaltyTierViewSet` — CRUD for tiers |
| **Missing** | `LoyaltyMembershipAdjustView` — staff points adjustment |
| **Missing** | `ReferralCodeUsesView` — list `ReferralUse` for a code |
| **Missing** | `ValidateReferralCodeView` — public endpoint for booking widget |
| **Missing** | `MemberLoyaltyShortcutView` — `GET /members/{id}/loyalty/` |

### members/models.py — all additions missing

`DuplicateFlag`, `SecondaryContact`, `LeadScore`, `SurveyResponse`, `is_archived` field on `Member` — none exist. All must be created.

### billing/models.py — all additions missing

`DunningTemplate`, `DebtNote`, `DunningLetter`, `DebtEscalation` — none exist.

### accounts/models.py — Marina fields missing

`points_earn_rate`, `points_to_currency_ratio`, `referral_referrer_benefit_type`, `referral_referrer_benefit_value`, `referral_referee_benefit_type`, `referral_referee_benefit_value`, `harbour_master_email` — none exist.

### Management commands — all missing

- `loyalty/management/commands/expire_points.py`
- `members/management/commands/recalculate_lead_scores.py`
- `members/management/commands/send_checkout_surveys.py`

---

## Models

### Step A: Add `is_archived` to `Member` (`members/models.py`)

```python
# Add to Member model
is_archived = models.BooleanField(default=False)
merged_into = models.ForeignKey(
    'self', null=True, blank=True,
    on_delete=models.SET_NULL, related_name='archived_duplicates'
)
```

### Step B: Add models to `members/models.py`

Add in this order (no interdependencies within the file):

1. `DuplicateFlag` — per spec §3.1. FKs: `Member` (twice), `staff.StaffMember`.
2. `SecondaryContact` — per spec §3.1. FK: `vessels.Vessel`.
3. `LeadScore` — per spec §3.1. OneToOne: `Member`.
4. `SurveyResponse` — per spec §3.1. FK: `Member`, `reservations.Booking`.

Migration filename: `members/migrations/0XXX_add_track3_models.py`

### Step C: Add models to `billing/models.py`

Add in this order:

1. `DunningTemplate` — FK: `accounts.Marina`, `staff.StaffMember`.
2. `DebtNote` — FKs: `Marina`, `members.Member`, M2M `Invoice`, `StaffMember`.
3. `DunningLetter` — FKs: `Marina`, `Member`, M2M `Invoice`, `StaffMember`.
4. `DebtEscalation` — FKs: `Marina`, `Member`, M2M `Invoice`, `StaffMember`.

Migration filename: `billing/migrations/0XXX_add_track3_debt_models.py`

### Step D: Add fields to `accounts.Marina`

```python
from decimal import Decimal

# Add to Marina model:
points_earn_rate = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal('1.00'))
points_to_currency_ratio = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal('100.00'))
referral_referrer_benefit_type = models.CharField(max_length=20, default='points')
referral_referrer_benefit_value = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
referral_referee_benefit_type = models.CharField(max_length=20, default='discount')
referral_referee_benefit_value = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
harbour_master_email = models.EmailField(blank=True)
```

Migration filename: `accounts/migrations/0XXX_add_marina_loyalty_fields.py`

### Step E: Rebuild `loyalty/models.py` (full replacement)

Replace the entire file with the following models. Keep `CouponCode`, `MemberCreditAccount`, `CreditTransaction` as-is at the bottom — they are used by existing views.

```python
# backend/apps/loyalty/models.py
import uuid
from decimal import Decimal
from django.db import models


class LoyaltyTier(models.Model):
    class QualificationBasis(models.TextChoices):
        CUMULATIVE_SPEND    = 'cumulative_spend',    'Cumulative Spend (€)'
        NUMBER_OF_STAYS     = 'number_of_stays',     'Number of Stays'
        YEARS_OF_MEMBERSHIP = 'years_of_membership', 'Years of Membership'

    class RequalificationPolicy(models.TextChoices):
        PERMANENT = 'permanent', 'Held Permanently Once Achieved'
        ANNUAL    = 'annual',    'Must Re-qualify Each Calendar Year'

    marina              = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='loyalty_tiers')
    name                = models.CharField(max_length=100)
    rank                = models.IntegerField(default=0)
    qualification_basis = models.CharField(max_length=30, choices=QualificationBasis.choices)
    threshold           = models.DecimalField(max_digits=12, decimal_places=2)
    berth_discount_pct  = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
    points_multiplier   = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('1.00'))
    priority_berth_allocation = models.BooleanField(default=False)
    complimentary_services    = models.JSONField(default=list, blank=True)
    requalification_policy    = models.CharField(
        max_length=20, choices=RequalificationPolicy.choices,
        default=RequalificationPolicy.PERMANENT
    )
    grace_period_days   = models.IntegerField(default=0)
    is_active           = models.BooleanField(default=True)

    class Meta:
        ordering = ['marina', 'rank']
        unique_together = [('marina', 'rank')]

    def __str__(self):
        return f'{self.name} (rank {self.rank})'


class LoyaltyMembership(models.Model):
    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='loyalty_memberships')
    member           = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='loyalty_membership')
    tier             = models.ForeignKey(
        LoyaltyTier, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='memberships'
    )
    points_balance   = models.IntegerField(default=0)
    lifetime_spend   = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    qualifying_stays = models.IntegerField(default=0)
    tier_achieved_at = models.DateTimeField(null=True, blank=True)
    tier_expires_at  = models.DateTimeField(null=True, blank=True)
    last_activity_at = models.DateTimeField(null=True, blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'member')]

    def __str__(self):
        tier_name = self.tier.name if self.tier else 'No tier'
        return f'{self.member} — {tier_name} ({self.points_balance} pts)'


class PointsLedger(models.Model):
    class EntryType(models.TextChoices):
        EARN     = 'earn',     'Points Earned'
        REDEEM   = 'redeem',   'Points Redeemed'
        EXPIRE   = 'expire',   'Points Expired'
        ADJUST   = 'adjust',   'Manual Adjustment'
        REFERRAL = 'referral', 'Referral Bonus'

    membership    = models.ForeignKey(LoyaltyMembership, on_delete=models.CASCADE, related_name='ledger_entries')
    entry_type    = models.CharField(max_length=20, choices=EntryType.choices)
    points        = models.IntegerField()           # Positive = earn; negative = redeem/expire
    balance_after = models.IntegerField()
    description   = models.CharField(max_length=255, blank=True)
    invoice       = models.ForeignKey(
        'billing.Invoice', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='points_entries'
    )
    line_item     = models.ForeignKey(
        'billing.InvoiceLineItem', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='points_redemption'
    )
    created_at    = models.DateTimeField(auto_now_add=True)
    created_by    = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='points_entries'
    )

    class Meta:
        ordering = ['-created_at']


class ReferralCode(models.Model):
    marina                 = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='referral_codes')
    member                 = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='referral_code')
    code                   = models.CharField(max_length=20)
    referrer_benefit_type  = models.CharField(max_length=20, default='points')
    referrer_benefit_value = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    referee_benefit_type   = models.CharField(max_length=20, default='discount')
    referee_benefit_value  = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    is_active              = models.BooleanField(default=True)
    created_at             = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'member'), ('marina', 'code')]


class ReferralUse(models.Model):
    class BenefitStatus(models.TextChoices):
        PENDING  = 'pending',  'Pending First Booking'
        APPLIED  = 'applied',  'Benefit Applied'
        REJECTED = 'rejected', 'Rejected (Ineligible)'

    referral_code                = models.ForeignKey(ReferralCode, on_delete=models.CASCADE, related_name='uses')
    referee_member               = models.ForeignKey(
        'members.Member', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='referral_uses'
    )
    referee_booking              = models.ForeignKey(
        'reservations.Booking', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='referral_use'
    )
    benefit_status               = models.CharField(max_length=20, choices=BenefitStatus.choices, default=BenefitStatus.PENDING)
    referrer_benefit_applied_at  = models.DateTimeField(null=True, blank=True)
    referee_benefit_applied_at   = models.DateTimeField(null=True, blank=True)
    created_at                   = models.DateTimeField(auto_now_add=True)


# Keep existing models below — used by existing views, superseded by Track 4 for credit wallet
class CouponCode(models.Model):
    # ... (keep existing definition unchanged)
    pass  # placeholder — copy from existing file


class MemberCreditAccount(models.Model):
    # ... (keep existing definition unchanged)
    pass  # placeholder — copy from existing file


class CreditTransaction(models.Model):
    # ... (keep existing definition unchanged)
    pass  # placeholder — copy from existing file
```

> Note: When implementing, copy the full `CouponCode`, `MemberCreditAccount`, and `CreditTransaction` definitions from the current file verbatim. The `pass` placeholders above are for brevity only.

Migration filename: `loyalty/migrations/0XXX_rebuild_loyalty_models.py`

---

## Services

File: `backend/apps/loyalty/services.py` — full rewrite.

### `get_or_create_membership(member, marina) -> LoyaltyMembership`
Unchanged logic. Ensure `defaults` no longer includes `tier` (it starts as `None`).

### `calculate_points_earned(invoice, membership) -> int`
```python
def calculate_points_earned(invoice, membership: LoyaltyMembership) -> int:
    marina = invoice.marina
    multiplier = membership.tier.points_multiplier if membership.tier else Decimal('1.00')
    return int(invoice.total * marina.points_earn_rate * multiplier)
```

### `get_or_create_loyalty_chargeable_item(marina, label: str) -> ChargeableItem`
```python
def get_or_create_loyalty_chargeable_item(marina, label: str):
    from apps.billing.models import ChargeableItem
    item, _ = ChargeableItem.objects.get_or_create(
        marina=marina,
        name=label,
        defaults={
            'category': ChargeableItem.Category.SERVICE,
            'unit_price': Decimal('0.00'),
            'is_discountable': False,
        }
    )
    return item
```

### `earn_points(membership_pk, invoice, points: int, entry_type='earn', description='', created_by=None) -> PointsLedger`
```python
def earn_points(membership_pk, invoice, points: int, entry_type='earn', description='', created_by=None):
    from django.utils import timezone
    from apps.loyalty.models import LoyaltyMembership, PointsLedger
    if points <= 0:
        raise ValueError('points must be positive')
    with transaction.atomic():
        membership = LoyaltyMembership.objects.select_for_update().get(pk=membership_pk)
        new_balance = membership.points_balance + points
        entry = PointsLedger.objects.create(
            membership=membership,
            entry_type=entry_type,
            points=points,
            balance_after=new_balance,
            description=description,
            invoice=invoice,
            created_by=created_by,
        )
        membership.points_balance = new_balance
        if invoice:
            membership.lifetime_spend += invoice.total
            membership.qualifying_stays = F('qualifying_stays') + 1
        membership.last_activity_at = timezone.now()
        membership.save(update_fields=[
            'points_balance', 'lifetime_spend', 'qualifying_stays', 'last_activity_at'
        ])
        evaluate_tier(membership)
    return entry
```

### `redeem_points(membership_pk, points: int, invoice, created_by=None) -> PointsLedger`
```python
def redeem_points(membership_pk, points: int, invoice, created_by=None):
    from django.utils import timezone
    from apps.billing.models import InvoiceLineItem
    from apps.loyalty.models import LoyaltyMembership, PointsLedger
    if points <= 0:
        raise ValueError('points must be positive')
    with transaction.atomic():
        membership = LoyaltyMembership.objects.select_for_update().get(pk=membership_pk)
        if membership.points_balance < points:
            raise ValueError(
                f'Insufficient points: balance {membership.points_balance}, requested {points}'
            )
        marina = membership.marina
        credit_amount = (Decimal(points) / marina.points_to_currency_ratio).quantize(Decimal('0.01'))
        ci = get_or_create_loyalty_chargeable_item(marina, 'Points Redemption')
        line = InvoiceLineItem.objects.create(
            invoice=invoice,
            description=f'Points Redemption ({points} pts)',
            quantity=Decimal('1.00'),
            unit_price=-credit_amount,
            total_price=-credit_amount,
            chargeable_item=ci,
            tax_rate=Decimal('0.00'),
        )
        new_balance = membership.points_balance - points
        entry = PointsLedger.objects.create(
            membership=membership,
            entry_type=PointsLedger.EntryType.REDEEM,
            points=-points,
            balance_after=new_balance,
            description=f'Redeemed against invoice {invoice.invoice_number}',
            invoice=invoice,
            line_item=line,
            created_by=created_by,
        )
        membership.points_balance = new_balance
        membership.last_activity_at = timezone.now()
        membership.save(update_fields=['points_balance', 'last_activity_at'])
    return entry
```

### `adjust_points_manual(membership_pk, points: int, description: str, created_by) -> PointsLedger`
Points may be positive or negative. Uses `select_for_update`. Prevents balance going below 0.

### `evaluate_tier(membership: LoyaltyMembership) -> None`
```python
def evaluate_tier(membership):
    """
    Called inside an atomic block (after earn_points). Re-reads membership to get
    fresh values after F() expressions. Compares against LoyaltyTier thresholds.
    Promotes tier if threshold crossed. Sends congratulatory email on promotion.
    """
    from django.utils import timezone
    from apps.loyalty.models import LoyaltyTier
    membership.refresh_from_db()
    tiers = LoyaltyTier.objects.filter(
        marina=membership.marina, is_active=True
    ).order_by('-rank')
    for tier in tiers:
        basis = tier.qualification_basis
        value = {
            'cumulative_spend':    membership.lifetime_spend,
            'number_of_stays':     Decimal(membership.qualifying_stays),
            'years_of_membership': _years_of_membership(membership),
        }[basis]
        if value >= tier.threshold:
            if membership.tier_id != tier.pk:
                membership.tier = tier
                membership.tier_achieved_at = timezone.now()
                if tier.requalification_policy == LoyaltyTier.RequalificationPolicy.ANNUAL:
                    from dateutil.relativedelta import relativedelta
                    membership.tier_expires_at = timezone.now() + relativedelta(years=1)
                membership.save(update_fields=['tier', 'tier_achieved_at', 'tier_expires_at'])
                _send_tier_promotion_email(membership, tier)
            break
```

### `apply_tier_discount(booking, invoice) -> None`
Called from booking finalisation flow.
```python
def apply_tier_discount(booking, invoice):
    """
    If the booked member has a LoyaltyMembership with a tier that has berth_discount_pct > 0,
    create a negative InvoiceLineItem for the discount.
    """
    from apps.billing.models import InvoiceLineItem
    from apps.loyalty.models import LoyaltyMembership
    member = invoice.member
    if not member:
        return
    try:
        membership = LoyaltyMembership.objects.select_related('tier').get(
            marina=invoice.marina, member=member
        )
    except LoyaltyMembership.DoesNotExist:
        return
    if not membership.tier or membership.tier.berth_discount_pct <= 0:
        return
    berth_lines = invoice.items.filter(chargeable_item__category='berth')
    berth_total = sum(line.total_price for line in berth_lines)
    if berth_total <= 0:
        return
    discount_pct = membership.tier.berth_discount_pct
    discount_amount = (berth_total * discount_pct / 100).quantize(Decimal('0.01'))
    ci = get_or_create_loyalty_chargeable_item(
        invoice.marina,
        f'Loyalty Discount — {membership.tier.name}'
    )
    InvoiceLineItem.objects.create(
        invoice=invoice,
        description=f'Loyalty Discount — {membership.tier.name} ({discount_pct}%)',
        quantity=Decimal('1.00'),
        unit_price=-discount_amount,
        total_price=-discount_amount,
        chargeable_item=ci,
        tax_rate=Decimal('0.00'),
    )
```

### `apply_referral_benefits(referral_use: ReferralUse) -> None`
```python
def apply_referral_benefits(referral_use):
    """
    Called from BookingEngineRequestView when a referral code is supplied.
    Gate: referee must have zero confirmed/checked_out bookings.
    On pass: apply referee discount immediately. Mark referrer benefit PENDING
    until booking.total >= 50.00, then apply referrer benefit and set APPLIED.
    """
    from apps.reservations.models import Booking
    from apps.billing.models import InvoiceLineItem
    from django.utils import timezone

    referee = referral_use.referee_member
    has_prior = Booking.objects.filter(
        member=referee,
        status__in=['confirmed', 'checked_out']
    ).exists()
    if has_prior:
        referral_use.benefit_status = ReferralUse.BenefitStatus.REJECTED
        referral_use.save(update_fields=['benefit_status'])
        raise ValueError('referral_existing_customer')

    code = referral_use.referral_code
    booking = referral_use.referee_booking
    invoice = booking.invoices.filter(status='draft').first()

    # Apply referee discount immediately
    if code.referee_benefit_type == 'discount' and invoice:
        discount_amount = code.referee_benefit_value
        ci = get_or_create_loyalty_chargeable_item(invoice.marina, 'Referral Discount')
        InvoiceLineItem.objects.create(
            invoice=invoice,
            description=f'Referral Discount (code: {code.code})',
            quantity=Decimal('1.00'),
            unit_price=-discount_amount,
            total_price=-discount_amount,
            chargeable_item=ci,
            tax_rate=Decimal('0.00'),
        )
        referral_use.referee_benefit_applied_at = timezone.now()
        referral_use.save(update_fields=['referee_benefit_applied_at'])

    # Check qualifying spend for referrer benefit
    if booking.total >= Decimal('50.00'):
        _apply_referrer_benefit(referral_use, code)
        referral_use.benefit_status = ReferralUse.BenefitStatus.APPLIED
    # else: remain PENDING — checked again in award_points_on_payment signal
    referral_use.save()
```

### `check_pending_referral_benefits(invoice) -> None`
Called from `award_points_on_payment` signal. Finds any PENDING `ReferralUse` for the member and checks if qualifying spend is now met.

### `_send_tier_promotion_email(membership, tier) -> None`
Uses `anymail` / Resend. Body: "Congratulations, you are now a [tier.name] member at [marina.name]. Enjoy your new [tier.berth_discount_pct]% berth discount."

### `_years_of_membership(membership) -> Decimal`
Returns `Decimal((today - membership.created_at.date()).days / 365.25)`.

---

## API Endpoints

All registered under `/api/v1/` in `loyalty/urls.py`.

### Existing endpoints (keep, update serializers)

| Method | URL | View |
|---|---|---|
| GET | `/loyalty/memberships/` | `LoyaltyMembershipListView` |
| GET | `/loyalty/memberships/<pk>/` | `LoyaltyMembershipDetailView` |
| GET | `/loyalty/members/<member_id>/points/` | `PointsLedgerView` |
| GET | `/loyalty/members/<member_id>/credit/` | `MemberCreditAccountView` |
| GET | `/loyalty/members/<member_id>/credit/transactions/` | `MemberCreditTransactionsView` |
| POST | `/loyalty/top-up-credit/` | `TopUpCreditView` |
| GET/POST | `/loyalty/referral-codes/` | `ReferralCodeListCreateView` |
| GET/PATCH/DELETE | `/loyalty/referral-codes/<pk>/` | `ReferralCodeDetailView` |
| GET/POST | `/loyalty/coupons/` | `CouponCodeListCreateView` |
| GET/PATCH/DELETE | `/loyalty/coupons/<pk>/` | `CouponCodeDetailView` |
| POST | `/loyalty/apply-coupon/` | `ApplyCouponView` |

### New endpoints (add to `loyalty/urls.py`)

| Method | URL | View | Notes |
|---|---|---|---|
| GET/POST | `/loyalty/tiers/` | `LoyaltyTierViewSet` list/create | Marina-scoped ModelViewSet |
| GET/PATCH/DELETE | `/loyalty/tiers/<pk>/` | `LoyaltyTierViewSet` detail | DELETE blocked if memberships reference it |
| GET | `/loyalty/memberships/<pk>/points-ledger/` | `PointsLedgerView` | Paginated |
| POST | `/loyalty/memberships/<pk>/redeem/` | `RedeemPointsView` | Body: `{points, invoice_id}` |
| POST | `/loyalty/memberships/<pk>/adjust/` | `AdjustPointsView` | Staff-only; body: `{points, description}` |
| GET | `/loyalty/referral-codes/<pk>/uses/` | `ReferralCodeUsesView` | List `ReferralUse` records |
| POST | `/public/referral/validate/` | `ValidateReferralCodeView` | No auth; body: `{code, member_id}` |
| POST | `/loyalty/redeem-points/` | `RedeemPointsView` (legacy) | Keep old URL for backwards compat |

### New endpoints in `members/urls.py`

| Method | URL | View | Notes |
|---|---|---|---|
| GET | `/members/duplicates/` | `DuplicateFlagListView` | `?status=pending` |
| POST | `/members/check-duplicate/` | `CheckDuplicateView` | Body: `{name, email, phone, vessel_name}` |
| POST | `/members/duplicates/<id>/merge/` | `MergeDuplicateView` | Body: `{keep_member_id}` |
| POST | `/members/duplicates/<id>/dismiss/` | `DismissDuplicateView` | Returns 200 |
| GET | `/members/leads/` | `LeadListView` | Never-booked only; `?min_score=`, `?ordering=` |
| GET | `/members/<id>/lead-score/` | `LeadScoreDetailView` | |
| GET | `/members/<id>/loyalty/` | `MemberLoyaltyShortcutView` | Returns `LoyaltyMembership` or 404 |

### New endpoints in `billing/urls.py`

| Method | URL | View | Notes |
|---|---|---|---|
| GET | `/billing/members/<member_id>/debt-notes/` | `DebtNoteListCreateView` | |
| POST | `/billing/members/<member_id>/debt-notes/` | `DebtNoteListCreateView` | |
| GET | `/billing/members/<member_id>/dunning/` | `DunningLetterListView` | |
| POST | `/billing/members/<member_id>/dunning/` | `GenerateDunningLetterView` | Body: `{invoice_ids, send_via}` |
| GET | `/billing/dunning/<id>/pdf/` | `DunningLetterPDFView` | Stream PDF |
| POST | `/billing/members/<member_id>/escalate/` | `CreateEscalationView` | |
| PATCH | `/billing/escalations/<id>/` | `EscalationUpdateView` | |
| GET | `/billing/dunning-templates/` | `DunningTemplateListView` | |
| PUT | `/billing/dunning-templates/<level>/` | `DunningTemplateUpdateView` | Upsert by level |

### New endpoints in `members/urls.py` — Secondary Contacts (via vessel)

| Method | URL | View | Notes |
|---|---|---|---|
| GET/POST | `/vessels/<vessel_id>/contacts/` | `SecondaryContactListCreateView` | |
| PATCH/DELETE | `/vessels/<vessel_id>/contacts/<id>/` | `SecondaryContactDetailView` | |

### New endpoints for Surveys

Register under `members/urls.py` or a new `surveys/urls.py`:

| Method | URL | View | Notes |
|---|---|---|---|
| POST | `/surveys/respond/` | `SurveyRespondView` | Public, token-authenticated |
| GET | `/surveys/` | `SurveyListView` | Staff; `?min_nps=`, `?max_nps=`, `?booking=` |
| GET | `/surveys/nps-summary/` | `NPSSummaryView` | `?period=30d\|90d\|12m` |

---

## Signals

File: `backend/apps/loyalty/signals.py` — rewrite.

### Signal 1: `award_points_on_payment` (post_save on `Payment`)
```python
@receiver(post_save, sender=Payment)
def award_points_on_payment(sender, instance, created, **kwargs):
    if not created:
        return
    invoice = instance.invoice
    member = invoice.member
    if not member:
        return
    from apps.loyalty.services import (
        get_or_create_membership, calculate_points_earned, earn_points,
        check_pending_referral_benefits,
    )
    membership = get_or_create_membership(member, invoice.marina)
    points = calculate_points_earned(invoice, membership)
    if points > 0:
        earn_points(
            membership_pk=membership.pk,
            invoice=invoice,
            points=points,
            entry_type='earn',
            description=f'Invoice {invoice.invoice_number} payment',
        )
    check_pending_referral_benefits(invoice)
```

### Signal 2: `alert_on_low_nps` (post_save on `SurveyResponse`)
File: `backend/apps/members/signals.py` (new or add to existing).
```python
from django.db.models.signals import post_save
from django.dispatch import receiver

@receiver(post_save, sender='members.SurveyResponse')
def alert_on_low_nps(sender, instance, created, **kwargs):
    if not created:
        return
    if instance.nps_score <= 6 and not instance.alert_sent:
        marina = instance.marina
        if marina.harbour_master_email:
            # Send alert via anymail/Resend
            from django.core.mail import send_mail
            send_mail(
                subject=f'Low NPS Alert — {marina.name}',
                message=(
                    f'Member {instance.member} submitted an NPS score of '
                    f'{instance.nps_score} for booking {instance.booking_id}.\n\n'
                    f'Comments: {instance.comments}'
                ),
                from_email=None,  # uses DEFAULT_FROM_EMAIL
                recipient_list=[marina.harbour_master_email],
            )
            type(instance).objects.filter(pk=instance.pk).update(alert_sent=True)
```

### Signal 3: Duplicate detection on Member save
File: `backend/apps/members/signals.py`.
```python
@receiver(post_save, sender='members.Member')
def check_for_duplicate_on_save(sender, instance, created, **kwargs):
    if not created:
        return
    from apps.members.services import check_for_duplicates
    check_for_duplicates(
        marina=instance.marina,
        new_member=instance,
        name=instance.name,
        email=instance.email,
        phone=getattr(instance, 'phone', ''),
        vessel_name='',  # caller may pass via request context; signal uses empty fallback
    )
```

---

## Services — `members/services.py` (new file)

### `check_for_duplicates(marina, new_member, name, email, phone, vessel_name) -> list[DuplicateFlag]`
Implements the three deterministic rules:
1. Case-insensitive email match: `Member.objects.filter(marina=marina, email__iexact=email).exclude(pk=new_member.pk)`
2. Normalised phone match: strip whitespace, compare.
3. Exact vessel name (case-insensitive) AND `difflib.SequenceMatcher(None, name_a.lower(), name_b.lower()).ratio() >= 0.85`.

For each match: `DuplicateFlag.objects.get_or_create(member_a=..., member_b=..., defaults={...})`. Always put the lower PK as `member_a` to avoid duplicate pairs.

### `merge_members(flag_id, keep_member_id, resolved_by) -> Member`
Runs in `transaction.atomic()`. Reassigns: `Booking`, `Invoice`, `DebtNote`, `DunningLetter`, `SurveyResponse`, `LoyaltyMembership` (move ledger entries), `Document`. Archives discard member (`is_archived=True`, `merged_into=keep_member`). Updates `DuplicateFlag.status='merged'`.

---

## Services — `billing/services.py` (additions)

### `generate_dunning_letter(member, invoice_ids, send_via, generated_by) -> DunningLetter`
1. Determine `level = max(existing DunningLetter.level for member, default 0) + 1`.
2. `demand_amount = Invoice.objects.filter(pk__in=invoice_ids).aggregate(Sum('total'))['total__sum']`
3. `total_account_balance = Invoice.objects.filter(member=member, status__in=['unpaid','open']).aggregate(Sum('total'))['total__sum']`
4. Look up `DunningTemplate` for `(marina, level)`. Fall back to built-in default string if none.
5. Substitute `{{variable}}` placeholders. Available: `member_name`, `demand_amount`, `total_account_balance`, `marina_name`, `invoice_list`, `promised_date`, `harbour_master_name`.
6. Render HTML via `billing/templates/billing/dunning_letter.html`. Generate PDF with WeasyPrint.
7. Save PDF to `DunningLetter.pdf_document`. If `send_via='email'`, send via anymail and set `status='sent'`.

---

## Admin

Register all new models in `members/admin.py`, `billing/admin.py`, `loyalty/admin.py`. Minimum:

```python
# members/admin.py additions
from apps.members.models import DuplicateFlag, SecondaryContact, LeadScore, SurveyResponse
admin.site.register(DuplicateFlag, list_display=['marina', 'member_a', 'member_b', 'match_rule', 'status'])
admin.site.register(SecondaryContact, list_display=['marina', 'vessel', 'name', 'role', 'routing'])
admin.site.register(LeadScore, list_display=['marina', 'member', 'score', 'recalculated_at'])
admin.site.register(SurveyResponse, list_display=['marina', 'member', 'nps_score', 'alert_sent', 'created_at'])

# billing/admin.py additions
admin.site.register(DunningTemplate, list_display=['marina', 'level', 'subject', 'updated_at'])
admin.site.register(DebtNote, list_display=['marina', 'member', 'contact_method', 'outcome', 'created_at'])
admin.site.register(DunningLetter, list_display=['marina', 'member', 'level', 'status', 'generated_at'])
admin.site.register(DebtEscalation, list_display=['marina', 'member', 'escalate_to', 'status'])

# loyalty/admin.py additions
admin.site.register(LoyaltyTier, list_display=['marina', 'name', 'rank', 'threshold', 'berth_discount_pct'])
admin.site.register(LoyaltyMembership, list_display=['marina', 'member', 'tier', 'points_balance', 'lifetime_spend'])
admin.site.register(PointsLedger, list_display=['membership', 'entry_type', 'points', 'balance_after', 'created_at'])
admin.site.register(ReferralUse, list_display=['referral_code', 'referee_member', 'benefit_status'])
```

---

## Management Commands

### `loyalty/management/commands/expire_points.py`

```
python manage.py expire_points
```

Algorithm:
1. Find `LoyaltyMembership` where `last_activity_at < now() - timedelta(days=700)` (24-month - 30-day warning) and `points_balance > 0`. Send reminder email to each — "Your points expire in 30 days."
2. Find `LoyaltyMembership` where `last_activity_at < now() - timedelta(days=730)` and `points_balance > 0`.
3. For each: within `transaction.atomic()` + `select_for_update()`: create `PointsLedger(entry_type='expire', points=-membership.points_balance, balance_after=0)`, set `membership.points_balance = 0`, save.

Run nightly via cron or Celery Beat. Idempotent: `PointsLedger` entry with `entry_type='expire'` for today's date is not re-created if already present.

### `members/management/commands/recalculate_lead_scores.py`

```
python manage.py recalculate_lead_scores
```

Algorithm:
1. `never_booked_members = Member.objects.filter(marina=marina).exclude(bookings__status__in=['confirmed','checked_out']).distinct()`
2. For each member, compute composite score from `LeadScore` fields using weights from settings (see spec §4.4).
3. `LeadScore.objects.update_or_create(member=member, marina=marina, defaults={...})`.

### `members/management/commands/send_checkout_surveys.py`

```
python manage.py send_checkout_surveys
```

Algorithm:
1. Find `Booking` where `status='checked_out'`, `check_out` between `now() - 25h` and `now() - 23h`, no `SurveyResponse` linked.
2. Generate signed token: `TimestampSigner().sign(booking.pk)`.
3. Build URL: `{settings.PORTAL_BASE_URL}/survey/?token={token}`.
4. Send email to member. Log to a management command log file.

---

## Settings / URL Wiring

### `config/settings/base.py`

No new apps needed — `apps.loyalty` is already registered. Add:
```python
LEAD_SCORE_WEIGHTS = {
    'portal_login_30d':           20,
    'email_open_30d_per_open':    10,
    'email_open_30d_max':         30,
    'booking_widget_14d':         25,
    'vessel_loa_match':           15,
}
SURVEY_TOKEN_MAX_AGE = 60 * 60 * 24 * 7  # 7 days in seconds
PORTAL_BASE_URL = os.environ.get('PORTAL_BASE_URL', 'https://portal.example.com')
```

### `config/urls.py`

Add to `api/v1/` includes:
```python
path('', include('apps.members.urls')),   # already included — ensure new paths are in members/urls.py
path('', include('apps.billing.urls')),   # already included
path('', include('apps.loyalty.urls')),   # already included
path('', include('apps.surveys.urls')),   # only if survey views go in a separate file
```

If survey views live in `members/views.py`, no new include is needed — just add the URL patterns to `members/urls.py`.

---

## Migration Notes

Run migrations in this order to respect FK dependencies:

1. `python manage.py makemigrations accounts` — Marina new fields
2. `python manage.py makemigrations members` — `is_archived`, `merged_into`, new models
3. `python manage.py makemigrations billing` — debt models
4. `python manage.py makemigrations loyalty` — `LoyaltyTier`, rebuilt `LoyaltyMembership`, `PointsLedger`, rebuilt `ReferralCode`, `ReferralUse`
5. `python manage.py migrate`

**Data migration for existing `LoyaltyMembership` records:**
Write a `RunPython` step in the loyalty migration that:
- Creates a default `LoyaltyTier` for each marina (e.g. "Bronze", rank=0, threshold=0, `qualification_basis='cumulative_spend'`).
- Sets `LoyaltyMembership.tier = bronze_tier` for all existing memberships.
- Converts existing `PointTransaction` records to `PointsLedger` records, computing `balance_after` cumulatively per membership.

---

## Implementation Order (numbered steps)

1. **Add `is_archived` + `merged_into` to `Member`** (`members/models.py`). Run migration.

2. **Add Marina loyalty fields** (`accounts/models.py`). Run migration.

3. **Add `members` app new models** — `DuplicateFlag`, `SecondaryContact`, `LeadScore`, `SurveyResponse`. Run migration.

4. **Add `billing` app debt models** — `DunningTemplate`, `DebtNote`, `DunningLetter`, `DebtEscalation`. Run migration.

5. **Rebuild `loyalty/models.py`** — add `LoyaltyTier`, rebuild `LoyaltyMembership` (FK to tier, new fields), rename `PointTransaction` → `PointsLedger` (add `balance_after`, `invoice`, `line_item`, `created_by`), rebuild `ReferralCode` (benefit fields), add `ReferralUse`. Write data migration for existing records. Run migration.

6. **Rewrite `loyalty/services.py`** — implement all functions listed in the Services section above. Keep `apply_coupon`, `top_up_credit`, `spend_credit`, `get_or_create_credit_account` as-is (they reference models that are unchanged).

7. **Add `members/services.py`** — `check_for_duplicates()`, `merge_members()`.

8. **Add `billing/services.py` additions** — `generate_dunning_letter()`, `compute_demand_amount()`.

9. **Rewrite `loyalty/signals.py`** — update `award_points_on_payment` to use new service functions.

10. **Add `members/signals.py`** — `alert_on_low_nps`, `check_for_duplicate_on_save`. Register in `members/apps.py` `ready()`.

11. **Write serializers for all new models** — one serializer per model in the appropriate `serializers.py`. For `PointsLedger`, include nested `invoice_number` and `line_item_id`.

12. **Rewrite `loyalty/views.py`** — update existing views to use new models, add new ViewSets and action views.

13. **Add `members/views.py` additions** — `DuplicateFlagListView`, `CheckDuplicateView`, `MergeDuplicateView`, `DismissDuplicateView`, `LeadListView`, `LeadScoreDetailView`, `MemberLoyaltyShortcutView`. Add `SecondaryContactListCreateView`, `SecondaryContactDetailView`.

14. **Add `billing/views.py` additions** — `DebtNoteListCreateView`, `DunningLetterListView`, `GenerateDunningLetterView`, `DunningLetterPDFView`, `CreateEscalationView`, `EscalationUpdateView`, `DunningTemplateListView`, `DunningTemplateUpdateView`.

15. **Add survey views** — `SurveyRespondView` (public, token-auth), `SurveyListView`, `NPSSummaryView`. Add to `members/views.py` or new `surveys/views.py`.

16. **Update `loyalty/urls.py`** — register all new endpoints.

17. **Update `members/urls.py`** — register duplicate, merge, lead score, secondary contact, survey, and member loyalty shortcut endpoints.

18. **Update `billing/urls.py`** — register all debt/dunning endpoints.

19. **Register all new models in admin** — `members/admin.py`, `billing/admin.py`, `loyalty/admin.py`.

20. **Management command: `expire_points`** — `loyalty/management/commands/expire_points.py`.

21. **Management command: `recalculate_lead_scores`** — `members/management/commands/recalculate_lead_scores.py`.

22. **Management command: `send_checkout_surveys`** — `members/management/commands/send_checkout_surveys.py`.

23. **Add dunning PDF template** — `billing/templates/billing/dunning_letter.html`. WeasyPrint-compatible HTML with marina branding, `{{variable}}` substitution via Django `Template`.

24. **Write unit tests** — `loyalty/tests/test_services.py`: earn/redeem race condition (concurrent redemption), tier promotion, referral gate, expiry idempotency. `members/tests/test_services.py`: all three duplicate-detection rules, merge transaction correctness.

25. **Wire `apply_tier_discount` into booking finalisation** — in `reservations/services.py` or wherever `Invoice` is created for a booking, call `apply_tier_discount(booking, invoice)` after the invoice is saved and line items are written.

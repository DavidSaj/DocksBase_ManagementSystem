# Track 3 — Customer Intelligence & Loyalty: Design Spec
Date: 2026-05-07
Scope: Customer & Member Management (§5.1–5.5) and Loyalty Programme (§6.1–6.3) from `new_features.md`. Covers smart deduplication, crew/agent contacts, aged debtor SmartNotes with dunning letters, lead scoring, post-stay NPS surveys, and a full tier/points/referral loyalty programme.

> Spec status: Final — reviewed 2026-05-08

---

## 1. Architectural Goal

Extend the existing `members` app and add a new `loyalty` app so that:

1. **No duplicate member records enter the system** — the save path runs a deterministic identity check before committing any new `Member`. Fuzzy name-only matching is not used; duplicates are flagged only when deterministic signals (email, phone, or vessel+name combination) match.
2. **Multiple humans can be associated with a single vessel** — crew members, skippers, and commercial agents are first-class contacts, each with their own notification routing.
3. **Debt recovery has a structured paper trail** — every chase attempt, dunning letter, and escalation is logged against an overdue invoice, visible to all staff from the Billing screen.
4. **Unconverted leads are scored automatically** — engagement signals feed a composite score so staff know who to call first. The lead list is strictly for members who have never made a confirmed booking; lapsed customers are kept entirely separate.
5. **Customer satisfaction is captured at check-out** — NPS surveys fire automatically 24 hours after check-out and low scores generate an immediate alert to the harbour master.
6. **Loyalty discounts are applied through the existing `ChargeableItem` / `InvoiceLineItem` pipeline** — no discount logic is embedded in booking or billing code; the loyalty engine always produces an `InvoiceLineItem` with a negative `unit_price`, linked to a `ChargeableItem` of category `service`.

The result is a system where `Member` remains the canonical identity record, `ChargeableItem` remains the single source of truth for all financial values (including loyalty discounts), and all new behaviour lives in clearly bounded apps/models that filter by `request.user.marina`.

---

## 2. New Django App (if needed) or Model Location

| App | New or existing | What lives here |
|-----|----------------|-----------------|
| `members` | Existing — add models | `DuplicateFlag`, `SecondaryContact`, `LeadScore`, `SurveyResponse` |
| `billing` | Existing — add models | `DebtNote`, `DunningLetter`, `DunningTemplate`, `DebtEscalation` |
| `loyalty` | **New app** | `LoyaltyTier`, `LoyaltyMembership`, `PointsLedger`, `ReferralCode`, `ReferralUse` |

Create the new app with:
```
python manage.py startapp loyalty
```
Register it in `INSTALLED_APPS` as `'apps.loyalty'`. All models follow the standard multi-tenancy pattern: `marina = ForeignKey('accounts.Marina', on_delete=models.CASCADE)`.

---

## 3. Data Models (Django class definitions)

### 3.1 `members` app additions

```python
# backend/apps/members/models.py — additions

class DuplicateFlag(models.Model):
    """
    Created by the duplicate-detection service when a new Member is saved
    and a deterministic identity signal matches an existing record.
    Staff resolve by merging or dismissing.
    """
    class Status(models.TextChoices):
        PENDING   = 'pending',   'Pending Review'
        MERGED    = 'merged',    'Merged'
        DISMISSED = 'dismissed', 'Dismissed (Not a Duplicate)'

    class MatchRule(models.TextChoices):
        EXACT_EMAIL  = 'exact_email',  'Exact Email Match'
        EXACT_PHONE  = 'exact_phone',  'Exact Phone Match'
        VESSEL_NAME  = 'vessel_name',  'Vessel Name + Similar Owner Name'

    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='duplicate_flags')
    member_a     = models.ForeignKey('Member', on_delete=models.CASCADE, related_name='duplicate_flags_as_a')
    member_b     = models.ForeignKey('Member', on_delete=models.CASCADE, related_name='duplicate_flags_as_b')
    match_rule   = models.CharField(max_length=30, choices=MatchRule.choices)  # Which rule triggered this flag
    match_fields = models.JSONField(default=list)  # e.g. ["email"] or ["vessel_name", "name"]
    name_similarity = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True
    )  # Only populated for VESSEL_NAME rule; 0–100 score from difflib
    status       = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    merged_into  = models.ForeignKey(
        'Member', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='merged_duplicates'
    )
    created_at   = models.DateTimeField(auto_now_add=True)
    resolved_at  = models.DateTimeField(null=True, blank=True)
    resolved_by  = models.ForeignKey(
        'staff.StaffMember', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='resolved_duplicates'
    )

    class Meta:
        ordering = ['-created_at']
        unique_together = [('member_a', 'member_b')]


class SecondaryContact(models.Model):
    """
    Crew member, skipper, captain, or managing agent linked to a Vessel.
    Notifications can be routed to this contact instead of (or in addition to)
    the registered vessel owner.
    """
    class Role(models.TextChoices):
        SKIPPER = 'skipper', 'Skipper / Captain'
        CREW    = 'crew',    'Crew Member'
        AGENT   = 'agent',   'Managing Agent / Charter Manager'
        OTHER   = 'other',   'Other'

    class NotificationRouting(models.TextChoices):
        OWNER_ONLY    = 'owner_only',    'Owner Only'
        CONTACT_ONLY  = 'contact_only',  'This Contact Only'
        BOTH          = 'both',          'Owner + This Contact'

    marina   = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='secondary_contacts')
    vessel   = models.ForeignKey('vessels.Vessel', on_delete=models.CASCADE, related_name='secondary_contacts')
    name     = models.CharField(max_length=200)
    email    = models.EmailField(blank=True)
    phone    = models.CharField(max_length=30, blank=True)
    role     = models.CharField(max_length=20, choices=Role.choices, default=Role.CREW)
    routing  = models.CharField(
        max_length=20, choices=NotificationRouting.choices,
        default=NotificationRouting.OWNER_ONLY
    )
    # Agents only:
    # When True, invoices/correspondence are sent to the agent email ONLY (not the owner).
    # Set cc_owner=True to additionally copy the owner.
    receives_invoices = models.BooleanField(default=False)
    cc_owner          = models.BooleanField(default=False)  # Only relevant when receives_invoices=True
    notes    = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['vessel', 'role', 'name']


class LeadScore(models.Model):
    """
    Engagement-based score for unconverted leads (Members who have NEVER had
    a confirmed Booking). Lapsed customers — those with historical confirmed
    bookings but none in the last 12 months — are NOT included here; they are
    tracked separately outside this model.
    Recalculated nightly by a management command.
    """
    member          = models.OneToOneField('Member', on_delete=models.CASCADE, related_name='lead_score')
    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='lead_scores')
    score           = models.IntegerField(default=0)  # 0–100 composite
    portal_logins   = models.IntegerField(default=0)
    email_opens     = models.IntegerField(default=0)
    booking_widget_interactions = models.IntegerField(default=0)
    last_activity   = models.DateTimeField(null=True, blank=True)
    recalculated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-score']


class SurveyResponse(models.Model):
    """
    Post-stay NPS survey submitted by a boater 24 hours after check-out.
    One response per Booking. Low scores (NPS <= 6) generate an immediate alert
    to the harbour master email configured on the Marina.
    """
    class Channel(models.TextChoices):
        EMAIL  = 'email',  'Email Link'
        PORTAL = 'portal', 'Customer Portal'
        STAFF  = 'staff',  'Staff Entered'

    marina    = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='survey_responses')
    member    = models.ForeignKey('Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='survey_responses')
    booking   = models.OneToOneField(
        'reservations.Booking', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='survey_response'
    )
    nps_score      = models.IntegerField()           # 0–10
    overall_score  = models.IntegerField(null=True, blank=True)  # 1–5, optional overall rating
    comments       = models.TextField(blank=True)
    channel        = models.CharField(max_length=20, choices=Channel.choices, default=Channel.EMAIL)
    alert_sent     = models.BooleanField(default=False)  # True once harbour master alerted
    created_at     = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
```

### 3.2 `billing` app additions

```python
# backend/apps/billing/models.py — additions

class DunningTemplate(models.Model):
    """
    Marina-editable letter body for each dunning level (1–5).
    Stored as plain text supporting {{variable}} substitution.
    Available variables: {{member_name}}, {{demand_amount}}, {{total_account_balance}},
    {{marina_name}}, {{invoice_list}}, {{promised_date}}, {{harbour_master_name}}.

    {{demand_amount}} = sum of the invoices explicitly selected for this letter.
    {{total_account_balance}} = sum of ALL outstanding invoices on the account.
    These must be kept separate to avoid implying a waiver of invoices not included
    in the demand — a formal letter that states a lower total than the actual debt
    can be used in court to argue the marina waived the remainder.

    If no custom template exists for a level, the system uses a built-in default.
    """
    marina  = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='dunning_templates')
    level   = models.IntegerField()   # 1 = polite reminder … 5 = final demand
    subject = models.CharField(max_length=255)
    body    = models.TextField()
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='dunning_templates'
    )

    class Meta:
        unique_together = [('marina', 'level')]
        ordering = ['marina', 'level']


class DebtNote(models.Model):
    """
    A single logged chase interaction against one or more overdue invoices.
    Equivalent to a 'SmartNote' in the aged debtor workflow.
    """
    class ContactMethod(models.TextChoices):
        CALL  = 'call',  'Phone Call'
        EMAIL = 'email', 'Email'
        SMS   = 'sms',   'SMS'
        POST  = 'post',  'Letter / Post'
        VISIT = 'visit', 'In-Person Visit'

    class Outcome(models.TextChoices):
        NO_ANSWER        = 'no_answer',        'No Answer'
        PROMISED_TO_PAY  = 'promised_to_pay',  'Promised to Pay'
        DISPUTED         = 'disputed',         'Debt Disputed'
        PARTIAL_PAYMENT  = 'partial_payment',  'Partial Payment Agreed'
        ESCALATED        = 'escalated',        'Escalated'
        RESOLVED         = 'resolved',         'Resolved'
        OTHER            = 'other',            'Other'

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='debt_notes')
    member          = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='debt_notes')
    invoices        = models.ManyToManyField('Invoice', related_name='debt_notes', blank=True)
    contact_method  = models.CharField(max_length=20, choices=ContactMethod.choices)
    outcome         = models.CharField(max_length=30, choices=Outcome.choices)
    promised_date   = models.DateField(null=True, blank=True)  # Set when outcome = PROMISED_TO_PAY
    notes           = models.TextField(blank=True)
    logged_by       = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='debt_notes'
    )
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class DunningLetter(models.Model):
    """
    A formal demand letter generated as a PDF, linked to a member's overdue debt.
    Letters escalate in tone through configurable levels 1–5.
    Letter body is rendered from the marina's DunningTemplate for the given level,
    falling back to built-in defaults if no custom template exists.
    """
    class Status(models.TextChoices):
        GENERATED = 'generated', 'Generated'
        SENT      = 'sent',      'Sent'
        DELIVERED = 'delivered', 'Delivered (Confirmed)'
        FAILED    = 'failed',    'Send Failed'

    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='dunning_letters')
    member         = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='dunning_letters')
    invoices       = models.ManyToManyField('Invoice', related_name='dunning_letters', blank=True)
    level          = models.IntegerField(default=1)   # 1 = polite reminder … 5 = final demand
    demand_amount          = models.DecimalField(max_digits=10, decimal_places=2,
                                                 help_text='Sum of the invoices explicitly selected for this letter.')
    total_account_balance  = models.DecimalField(max_digits=10, decimal_places=2,
                                                 help_text='Sum of ALL outstanding invoices on the account at generation time.')
    pdf_document   = models.FileField(upload_to='dunning/', null=True, blank=True)
    sent_via       = models.CharField(max_length=20, blank=True)  # 'email' | 'print'
    status         = models.CharField(max_length=20, choices=Status.choices, default=Status.GENERATED)
    generated_by   = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='dunning_letters'
    )
    generated_at   = models.DateTimeField(auto_now_add=True)
    sent_at        = models.DateTimeField(null=True, blank=True)


class DebtEscalation(models.Model):
    """
    Formal escalation record linking overdue debt to an assignee for resolution.
    """
    class EscalateTo(models.TextChoices):
        COLLECTIONS_OFFICER = 'collections_officer', 'Collections Officer'
        MANAGER             = 'manager',             'Harbour Master / Manager'
        EXTERNAL_AGENCY     = 'external_agency',     'External Debt Recovery Agency'

    class Status(models.TextChoices):
        OPEN     = 'open',     'Open'
        RESOLVED = 'resolved', 'Resolved'
        WRITTEN_OFF = 'written_off', 'Written Off'
        REFERRED    = 'referred',    'Referred to Agency'

    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='debt_escalations')
    member         = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='debt_escalations')
    invoices       = models.ManyToManyField('Invoice', related_name='debt_escalations', blank=True)
    escalate_to    = models.CharField(max_length=30, choices=EscalateTo.choices)
    assigned_to    = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='debt_escalations'
    )
    total_debt     = models.DecimalField(max_digits=10, decimal_places=2)
    due_date       = models.DateField(null=True, blank=True)
    notes          = models.TextField(blank=True)
    status         = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    created_at     = models.DateTimeField(auto_now_add=True)
    resolved_at    = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
```

### 3.3 `loyalty` app models

```python
# backend/apps/loyalty/models.py

from decimal import Decimal
from django.db import models


class LoyaltyTier(models.Model):
    """
    Marina-configurable loyalty tier (e.g. Bronze, Silver, Gold, Commodore).
    Defines qualification thresholds and the benefits granted to members at that tier.
    The points_multiplier is applied on top of the marina's global earn rate.
    """
    class QualificationBasis(models.TextChoices):
        CUMULATIVE_SPEND = 'cumulative_spend', 'Cumulative Spend (€)'
        NUMBER_OF_STAYS  = 'number_of_stays',  'Number of Stays'
        YEARS_OF_MEMBERSHIP = 'years_of_membership', 'Years of Membership'

    class RequalificationPolicy(models.TextChoices):
        PERMANENT = 'permanent', 'Held Permanently Once Achieved'
        ANNUAL    = 'annual',    'Must Re-qualify Each Calendar Year'

    marina              = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='loyalty_tiers')
    name                = models.CharField(max_length=100)        # e.g. "Gold"
    rank                = models.IntegerField(default=0)          # 0 = lowest; higher = better
    qualification_basis = models.CharField(max_length=30, choices=QualificationBasis.choices)
    threshold           = models.DecimalField(max_digits=12, decimal_places=2)
    berth_discount_pct  = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
    # Multiplier applied to the marina's global points earn rate for members at this tier.
    # e.g. 1.5 means Gold members earn 1.5x the baseline rate.
    points_multiplier   = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('1.00'))
    priority_berth_allocation = models.BooleanField(default=False)
    complimentary_services = models.JSONField(default=list, blank=True)  # e.g. ["pump_out", "parking"]
    requalification_policy = models.CharField(
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
    """
    The live loyalty status of a single member at a marina.
    Promoted automatically when qualifying thresholds are crossed.
    When a member is promoted, a congratulatory email is sent automatically.
    """
    marina            = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='loyalty_memberships')
    member            = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='loyalty_membership')
    tier              = models.ForeignKey(
        LoyaltyTier, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='memberships'
    )
    points_balance    = models.IntegerField(default=0)
    lifetime_spend    = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    qualifying_stays  = models.IntegerField(default=0)
    tier_achieved_at  = models.DateTimeField(null=True, blank=True)
    tier_expires_at   = models.DateTimeField(null=True, blank=True)  # Null = permanent
    last_activity_at  = models.DateTimeField(null=True, blank=True)
    created_at        = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'member')]


class PointsLedger(models.Model):
    """
    Immutable double-entry log of every points earn, redemption, expiry, or adjustment.
    The current balance is always the sum of all entries for a membership.

    Points expire on 24-month inactivity: the clock is tracked on
    LoyaltyMembership.last_activity_at (updated on every earn/redeem event).
    The nightly expire_points task checks that single field — it never mutates
    historical EARN rows. When expiry fires it inserts one EXPIRE entry that
    zeros the balance. Historical EARN rows are never modified after creation.

    There is no minimum redemption threshold; members may redeem any positive balance.
    """
    class EntryType(models.TextChoices):
        EARN       = 'earn',       'Points Earned'
        REDEEM     = 'redeem',     'Points Redeemed'
        EXPIRE     = 'expire',     'Points Expired'
        ADJUST     = 'adjust',     'Manual Adjustment'
        REFERRAL   = 'referral',   'Referral Bonus'

    membership  = models.ForeignKey(LoyaltyMembership, on_delete=models.CASCADE, related_name='ledger_entries')
    entry_type  = models.CharField(max_length=20, choices=EntryType.choices)
    points      = models.IntegerField()               # Positive = earn; negative = redeem/expire
    balance_after = models.IntegerField()             # Snapshot of balance after this entry
    description = models.CharField(max_length=255, blank=True)
    invoice     = models.ForeignKey(
        'billing.Invoice', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='points_entries'
    )
    # When redeemed, the resulting credit line item on the invoice
    line_item   = models.ForeignKey(
        'billing.InvoiceLineItem', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='points_redemption'
    )
    created_at  = models.DateTimeField(auto_now_add=True)
    created_by  = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='points_entries'
    )

    class Meta:
        ordering = ['-created_at']


class ReferralCode(models.Model):
    """
    One unique referral code per member per marina.
    Referrer benefit fires automatically when the referee completes their
    first booking with a qualifying spend of at least €50.
    """
    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='referral_codes')
    member        = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='referral_code')
    code          = models.CharField(max_length=20)
    referrer_benefit_type  = models.CharField(max_length=20, default='points')  # 'points' | 'discount' | 'free_nights'
    referrer_benefit_value = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    referee_benefit_type   = models.CharField(max_length=20, default='discount')
    referee_benefit_value  = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    is_active     = models.BooleanField(default=True)
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'member'), ('marina', 'code')]
        # ('marina', 'code') ensures codes like "SUMMER10" are unique per marina,
        # not globally — allowing different marinas to independently use the same code string.


class ReferralUse(models.Model):
    """
    Logged each time a referral code is used at booking. Tracks benefit application.
    Referee discount is applied automatically at booking creation.
    Referrer benefit transitions to APPLIED automatically once the referee's
    first booking reaches a minimum qualifying spend of €50.
    """
    class BenefitStatus(models.TextChoices):
        PENDING  = 'pending',  'Pending First Booking'
        APPLIED  = 'applied',  'Benefit Applied'
        REJECTED = 'rejected', 'Rejected (Ineligible)'

    referral_code    = models.ForeignKey(ReferralCode, on_delete=models.CASCADE, related_name='uses')
    referee_member   = models.ForeignKey(
        'members.Member', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='referral_uses'
    )
    referee_booking  = models.ForeignKey(
        'reservations.Booking', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='referral_use'
    )
    benefit_status   = models.CharField(max_length=20, choices=BenefitStatus.choices, default=BenefitStatus.PENDING)
    referrer_benefit_applied_at = models.DateTimeField(null=True, blank=True)
    referee_benefit_applied_at  = models.DateTimeField(null=True, blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)
```

### 3.4 `accounts.Marina` model additions

Add the following fields to the existing `Marina` model:

```python
# backend/apps/accounts/models.py — additions to Marina

# Loyalty: global points earn rate and conversion ratio
points_earn_rate          = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal('1.00'))
# e.g. 1.00 means 1 point per €1 spent. Tier multipliers are applied on top.
points_to_currency_ratio  = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal('100.00'))
# e.g. 100.00 means 100 points = €1.00. This rate is marina-wide and does not vary by tier.

# Referral programme: marina-level defaults for new referral codes
referral_referrer_benefit_type  = models.CharField(max_length=20, default='points')
referral_referrer_benefit_value = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
referral_referee_benefit_type   = models.CharField(max_length=20, default='discount')
referral_referee_benefit_value  = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))

# NPS alert routing: low-score survey alerts go to this address only
harbour_master_email = models.EmailField(blank=True)
```

---

## 4. API Contract

All endpoints are under `/api/v1/`. All views are `ModelViewSet` subclasses filtered by `request.user.marina`. Standard DRF pagination applies.

### 4.1 Deduplication

| Method | Endpoint | Notes |
|--------|----------|-------|
| `GET` | `/api/v1/members/duplicates/` | List all `DuplicateFlag` records for the marina. Query param: `?status=pending` |
| `POST` | `/api/v1/members/check-duplicate/` | Body: `{name, email, phone, vessel_name}`. Returns `{is_duplicate, flags: [...]}`. Called client-side on form submit before `POST /members/`. |
| `POST` | `/api/v1/members/duplicates/{id}/merge/` | Body: `{keep_member_id}`. Merges the secondary record into the canonical. Returns `204`. |
| `POST` | `/api/v1/members/duplicates/{id}/dismiss/` | Body: `{}`. Marks the flag `dismissed`. Returns `200`. |

**Duplicate detection rules (deterministic — no fuzzy name-only matching):**

A `DuplicateFlag` is created if and only if one of these three rules is satisfied:

1. **Exact Email Match** — the incoming `email` exactly matches an existing `Member.email` (case-insensitive).
2. **Exact Phone Match** — the incoming `phone` exactly matches an existing `Member.phone` (after stripping whitespace and normalising to E.164).
3. **Vessel Name + Similar Owner Name** — the incoming `vessel_name` exactly matches an existing `Vessel.name` (case-insensitive) AND the incoming `name` matches the vessel's owner's name with a `difflib.SequenceMatcher` ratio ≥ 0.85.

Fuzzy name-only matching is explicitly excluded to prevent false positives between members who share common names (e.g. two different "John Smiths" at the same marina).

**Merge logic (server-side, runs in a transaction):**
1. Re-assign all `Booking`, `Invoice`, `DebtNote`, `DunningLetter`, `SurveyResponse`, `PointsLedger` (via `LoyaltyMembership`), and `Document` rows from the discarded member to `keep_member_id`.
2. Archive the discarded `Member` by setting `is_archived = True` (add this BooleanField to `Member`) and storing `merged_into_id`.
3. Set `DuplicateFlag.status = 'merged'`, `merged_into = keep_member_id`, `resolved_at = now()`.

**Merge modal pre-selection:** The system automatically counts `Invoice` and `Booking` records attached to each member. The profile with the higher combined count is pre-selected as the canonical record to keep. The staff member may override this choice before confirming.

### 4.2 Secondary Contacts

| Method | Endpoint | Notes |
|--------|----------|-------|
| `GET` | `/api/v1/vessels/{vessel_id}/contacts/` | List all `SecondaryContact` for a vessel |
| `POST` | `/api/v1/vessels/{vessel_id}/contacts/` | Create a new contact |
| `PATCH` | `/api/v1/vessels/{vessel_id}/contacts/{id}/` | Edit name/role/routing/receives_invoices/cc_owner |
| `DELETE` | `/api/v1/vessels/{vessel_id}/contacts/{id}/` | Hard delete (no audit requirement for contacts) |

**Invoice routing behaviour when `receives_invoices = True`:**
- Invoices are sent to the agent email address only.
- The owner email is suppressed unless `cc_owner = True` is also set.
- This allows management companies to handle all billing correspondence without involving the vessel owner.

**PII protection — `billing_contact` override (Track 4 dependency):**

Standard invoices pull the "Bill To" block from the `Member` profile (name, address, phone, tax ID). Routing an invoice to a third-party charter agent while keeping the owner's PII in the "Bill To" block is a data-protection violation — the agent receives the beneficial owner's home address and tax identification.

The `Invoice` model (implemented in Track 4) must expose a `billing_contact` FK field:

```python
# billing.Invoice — add in Track 4 migration
billing_contact = models.ForeignKey(
    'members.SecondaryContact', on_delete=models.SET_NULL,
    null=True, blank=True,
    related_name='billed_invoices',
    help_text='When set, the invoice PDF replaces the Bill To block with this contact\'s '
              'name and address, shielding the member\'s PII from the third party.',
)
```

When a `SecondaryContact` with `receives_invoices=True` is the routing target, the invoice creation service must set `invoice.billing_contact = secondary_contact` before saving. The WeasyPrint PDF template must check: if `invoice.billing_contact` is set, render the "Bill To" block from `secondary_contact.name` / `secondary_contact.email` / `secondary_contact.phone` only — the owner's home address, personal phone, and tax ID must not appear anywhere in the document.

### 4.3 Debt Notes, Dunning Letters, Escalations

| Method | Endpoint | Notes |
|--------|----------|-------|
| `GET` | `/api/v1/billing/members/{member_id}/debt-notes/` | All notes for a member, newest first |
| `POST` | `/api/v1/billing/members/{member_id}/debt-notes/` | Log a chase interaction |
| `GET` | `/api/v1/billing/members/{member_id}/dunning/` | All dunning letters for a member |
| `POST` | `/api/v1/billing/members/{member_id}/dunning/` | Generate the next dunning level. Body: `{invoice_ids: [], send_via: "email"|"print"}`. Server determines `level` as `max(existing level) + 1`. Computes `demand_amount` as the sum of the selected `invoice_ids` only; computes `total_account_balance` as the sum of ALL outstanding invoices for that member regardless of selection. Both are stored on `DunningLetter` and substituted as separate template variables — they must never be conflated. Renders letter body from `DunningTemplate` (falls back to built-in defaults). Generates PDF via WeasyPrint, stores as `pdf_document`. |
| `GET` | `/api/v1/billing/dunning/{id}/pdf/` | Stream the PDF file |
| `POST` | `/api/v1/billing/members/{member_id}/escalate/` | Create a `DebtEscalation`. Body: `{escalate_to, assigned_to_id, invoice_ids, due_date, notes}` |
| `PATCH` | `/api/v1/billing/escalations/{id}/` | Update status (`resolved`, `written_off`, `referred`) |
| `GET` | `/api/v1/billing/dunning-templates/` | List all `DunningTemplate` records for the marina (levels 1–5) |
| `PUT` | `/api/v1/billing/dunning-templates/{level}/` | Create or update a template for a given level. Body: `{subject, body}`. |

### 4.4 Lead Scoring

| Method | Endpoint | Notes |
|--------|----------|-------|
| `GET` | `/api/v1/members/leads/` | Members with no confirmed booking of any kind (never-booked only), ordered by `lead_score__score` desc. Query params: `?min_score=50`, `?ordering=score`. |
| `GET` | `/api/v1/members/{id}/lead-score/` | Score detail for a single member |

The score is **read-only** from the API. It is recalculated by `python manage.py recalculate_lead_scores` (management command, runs nightly via cron/Celery beat). Scoring weights (configurable in settings, not per-marina):
- Portal login in last 30 days: +20
- Email opened in last 30 days: +10 per open, max +30
- Booking widget interaction in last 14 days: +25
- Vessel type/LOA matched to an available berth: +15

Members who have had confirmed bookings historically but none in the last 12 months are **not** included in the leads list. These lapsed customers require a separate workflow and messaging strategy and are out of scope for the lead scoring system.

### 4.5 Surveys

| Method | Endpoint | Notes |
|--------|----------|-------|
| `POST` | `/api/v1/surveys/respond/` | Public (token-authenticated, no session required). Body: `{token, nps_score, overall_score, comments}`. Token encodes `booking_id` and expires 7 days after check-out. |
| `GET` | `/api/v1/surveys/` | Staff: list all responses for marina. Query params: `?min_nps=0&max_nps=6` (detractors), `?booking=<id>`. |
| `GET` | `/api/v1/surveys/nps-summary/` | Returns `{promoters, passives, detractors, nps, period_start, period_end, count}`. Query param: `?period=30d|90d|12m`. |

**Alert rule:** When `nps_score <= 6`, the server immediately sends an email to `marina.harbour_master_email`. If `harbour_master_email` is blank, no fallback is applied — the field must be configured in Marina Settings. The server sets `SurveyResponse.alert_sent = True` after sending.

**Survey trigger:** A management command `send_checkout_surveys` runs every hour. It finds all `Booking` records where `status = 'checked_out'` and `check_out` is between 23 and 25 hours ago (targeting the 24-hour post-checkout window) and no `SurveyResponse` exists. It sends a survey email with a signed URL token generated via `django.core.signing.TimestampSigner`.

### 4.6 Loyalty — Tiers

| Method | Endpoint | Notes |
|--------|----------|-------|
| `GET` | `/api/v1/loyalty/tiers/` | All tiers for marina, ordered by rank |
| `POST` | `/api/v1/loyalty/tiers/` | Create a tier |
| `PATCH` | `/api/v1/loyalty/tiers/{id}/` | Edit benefits, thresholds |
| `DELETE` | `/api/v1/loyalty/tiers/{id}/` | Only if no `LoyaltyMembership` records reference it |

### 4.7 Loyalty — Member Status

| Method | Endpoint | Notes |
|--------|----------|-------|
| `GET` | `/api/v1/loyalty/memberships/` | All memberships for marina. Query param: `?tier=<id>`, `?member=<id>`. |
| `GET` | `/api/v1/loyalty/memberships/{id}/` | Detail including `ledger_entries` |
| `GET` | `/api/v1/members/{id}/loyalty/` | Shortcut: returns the `LoyaltyMembership` for a member (or 404 if none) |
| `GET` | `/api/v1/loyalty/memberships/{id}/points-ledger/` | Paginated ledger for a member |
| `POST` | `/api/v1/loyalty/memberships/{id}/redeem/` | Body: `{points, invoice_id}`. The redemption service wraps the balance check and ledger insertion in `transaction.atomic()` with `LoyaltyMembership.objects.select_for_update().get(pk=id)` — this acquires a Postgres row-level lock before reading `points_balance`, preventing double-spend if the same member taps Redeem twice in rapid succession. After locking: verify `points_balance >= points`, create the negative `InvoiceLineItem` via the loyalty discount `ChargeableItem` (see §4.9), append the REDEEM `PointsLedger` entry, update `membership.last_activity_at`, decrement `membership.points_balance`. Returns `400` if balance is insufficient. No minimum redemption amount is enforced beyond the balance check. |
| `POST` | `/api/v1/loyalty/memberships/{id}/adjust/` | Staff-only manual points adjustment. Body: `{points, description}`. |

### 4.8 Loyalty — Referrals

| Method | Endpoint | Notes |
|--------|----------|-------|
| `GET` | `/api/v1/loyalty/referral-codes/` | List referral codes for marina (staff) or own code (boater portal) |
| `POST` | `/api/v1/loyalty/referral-codes/` | Generate a code for a member. Code is auto-generated as `{MARINA_PREFIX}-{member.id}-{random4}`. Defaults populated from marina-level referral settings. |
| `GET` | `/api/v1/loyalty/referral-codes/{id}/uses/` | List `ReferralUse` records for a code |
| `POST` | `/api/v1/public/referral/validate/` | Public endpoint called from the booking widget. Body: `{code, member_id}`. Returns benefit summary or 404. Also returns `{"eligible": false, "reason": "existing_customer"}` (without a 4xx) if the requesting member already has a historical `Booking` with `status IN ('confirmed', 'checked_out')` — allows the widget to hide the benefit gracefully without a hard error before checkout. |

### 4.9 Loyalty Discount Line Item Pattern

Loyalty discounts (tier discount on berth fee, points redemption credit) **must** flow through `ChargeableItem` and `InvoiceLineItem`. The implementation rule:

1. Each marina with an active loyalty programme has exactly one `ChargeableItem` per active tier with `category='service'`, `name='Loyalty Discount — {tier.name}'`, and `unit_price=0.00` (the actual discount amount is computed at booking time and passed as `unit_price` on the line item — the `ChargeableItem` is the template).
2. Points redemption creates a `ChargeableItem` named `'Points Redemption'` with `unit_price=0.00` (same pattern).
3. When the loyalty engine applies a discount, it calls:

```python
InvoiceLineItem.objects.create(
    invoice=invoice,
    description=f"Loyalty Discount — {tier.name} ({discount_pct}%)",
    quantity=Decimal('1.00'),
    unit_price=-discount_amount,        # Always negative
    total_price=-discount_amount,
    chargeable_item=loyalty_chargeable_item,
    tax_rate=Decimal('0.00'),
)
```

**Points earn rate calculation:**
```python
points_earned = int(invoice_total * marina.points_earn_rate * membership.tier.points_multiplier)
```
If the member has no tier (no `LoyaltyMembership`), `points_multiplier` defaults to `1.00`. The `Marina.points_earn_rate` is the single global baseline (e.g. `1.00` = 1 point per €1 spent). Tier multipliers reward higher-tier members with proportionally more points without altering the currency value of a point.

**Points-to-currency conversion:**
```python
credit_amount = Decimal(points_to_redeem) / marina.points_to_currency_ratio
```
Example: `marina.points_to_currency_ratio = 100` → 100 points = €1.00.

This ensures all discounts appear transparently on the invoice and are auditable through the existing `InvoiceLineItem` history.

---

## 5. Frontend Architecture

### 5.1 Members screen additions (`Members.jsx`)

Add two new tabs to the existing `Members` tab bar:

```
Members & Owners | Document Vault | Communications | Segments | Loyalty | Leads
```

**New tab: Loyalty**
Component: `MemberLoyaltyTab.jsx`
- Renders a table of all `LoyaltyMembership` records for the marina.
- Columns: Member Name, Current Tier (badge), Points Balance, Lifetime Spend, Last Activity.
- Row click opens `LoyaltyMemberDrawer.jsx` (slide-in from right, 400px wide).
- `LoyaltyMemberDrawer` shows: tier badge with progress bar to next tier, points balance, last 10 ledger entries, and action buttons: `Adjust Points`, `Redeem Points`.

**New tab: Leads**
Component: `LeadScoringTab.jsx`
- Renders the lead list returned by `GET /api/v1/members/leads/`.
- This list contains only never-booked members; the UI should label it clearly ("Unconverted Leads") to distinguish it from any future lapsed-customer views.
- Columns: Name, Email, Lead Score (numeric + colour-coded bar), Last Activity, Portal Logins, Email Opens.
- Default sort: score descending.
- Row click shows a small detail popover with score breakdown and a `View Member` link.

**Additions to the existing member detail panel (right-hand side panel):**
- Add a "Loyalty" row showing current tier and points balance (fetched from `/members/{id}/loyalty/`).
- Add a "Duplicate Flags" banner at the top of the detail panel if `DuplicateFlag` records exist for this member with `status=pending`.

### 5.2 Vessel detail — Secondary Contacts sub-section

Location: wherever vessel detail is rendered (currently within the member row expansion or a vessel screen). Add a collapsible "Crew & Contacts" section.

Component: `VesselContactsPanel.jsx`
- Lists `SecondaryContact` records with role badge and routing label.
- Inline `+ Add Contact` button opens `ContactFormModal.jsx` (modal, not drawer — contacts are simple).
- `ContactFormModal` fields: Name, Email, Phone, Role (dropdown), Notification Routing (radio: Owner Only / This Contact Only / Both), Receives Invoices (checkbox, visible only when Role = Agent), CC Owner on Invoices (checkbox, visible only when Receives Invoices is checked — controls `cc_owner`).

### 5.3 Billing screen additions (`Billing.jsx`)

**Aged Debtors tab enhancements:**
The existing "Chase" button on debtor rows opens a new `DebtChaseDrawer.jsx` (slide-in, 480px wide) instead of the current no-op.

`DebtChaseDrawer.jsx` sections:
1. **Chase Log** — chronological list of `DebtNote` records, newest first. Each shows: date, method badge, outcome badge, promised date (if set), notes, logged-by name.
2. **Log Interaction** — inline form: contact method (select), outcome (select), promised date (date picker, visible when outcome = `promised_to_pay`), notes (textarea), `Log Note` button.
3. **Dunning Letters** — list of letters sent with level and date. `Generate Next Letter` button (disabled if all invoices paid). Shows letter level that will be generated (current max + 1). Send via radio: Email / Print.
4. **Escalation** — if no open escalation: `Escalate Debt` button opens a confirmation form. If open escalation exists: shows assignee, due date, status select (`resolved`, `written_off`, `referred`).

Hook: `useDebtChase.js` — fetches notes, letters, escalations for a member. Exposes `logNote`, `generateLetter`, `createEscalation`, `updateEscalation` mutations. React Query keys: `['debt-notes', memberId]`, `['dunning', memberId]`, `['escalation', memberId]`.

**Dunning template editor** (Billing Settings screen):
- A "Letter Templates" section in Billing Settings lists the five dunning levels.
- Each level shows the current subject and body (custom or default indicator).
- Clicking a level opens a `DunningTemplateModal.jsx` with a subject text field and a body textarea.
- The body textarea supports `{{variable}}` placeholders. A reference panel lists available variables: `{{member_name}}`, `{{demand_amount}}` (sum of selected invoices only), `{{total_account_balance}}` (all outstanding on account), `{{marina_name}}`, `{{invoice_list}}`, `{{promised_date}}`, `{{harbour_master_name}}`. The panel notes the distinction between the two debt figures explicitly so template authors understand the legal difference.
- Save calls `PUT /api/v1/billing/dunning-templates/{level}/`.

### 5.4 New screen: Customer Intelligence

Route: `/customer-intelligence`
Sidebar group: "Master Data" (already exists per service catalog spec).

Component: `CustomerIntelligenceScreen.jsx`
Tabs: `NPS & Surveys | Duplicate Flags`

**NPS & Surveys tab:**
- Top KPI row: NPS score (large number), Promoters / Passives / Detractors counts (period selector: 30d / 90d / 12m).
- Table of recent `SurveyResponse` records. Columns: Date, Member, Booking ref, NPS, Overall, Comments (truncated), Alert Sent badge.
- Clicking a row expands full comments inline.
- Filter: `Show Detractors Only` toggle (NPS 0–6).

**Duplicate Flags tab:**
- Table of `DuplicateFlag` records with `status=pending`. Columns: Member A (name/email), Member B (name/email), Match Rule, Match Fields.
- Row actions: `Review & Merge` button (opens `MergeModal.jsx`), `Dismiss` button.
- `MergeModal.jsx`: side-by-side comparison of both member records. The record with more Invoice + Booking records is pre-selected as canonical (highlighted with a "Recommended" label). Staff may switch the selection. Summary of records that will be re-assigned. `Confirm Merge` button.

### 5.5 Loyalty configuration screen

Route: `/loyalty` (under "Master Data" sidebar group).

Component: `LoyaltyConfigScreen.jsx`
Tabs: `Tiers | Referral Programme`

**Tiers tab:**
- List of `LoyaltyTier` records, ordered by rank. Columns: Rank, Name, Qualification Basis, Threshold, Berth Discount %, Points Multiplier, Re-qualification Policy.
- `+ New Tier` opens `TierFormDrawer.jsx`. Same drawer handles edit on row click.
- `TierFormDrawer`: all `LoyaltyTier` fields. Conditional field: if `qualification_basis != 'years_of_membership'`, show `grace_period_days`.
- Global loyalty settings section at the top of the tab: `Points Earn Rate` (per €1 spent) and `Points-to-Currency Ratio` (points per €1), both sourced from `Marina` model and editable here.

**Referral Programme tab:**
- Global referral defaults: referrer benefit type/value, referee benefit type/value (editable, stored on the `Marina` model).
- Table of all `ReferralCode` records. Columns: Member Name, Code, Uses (count), Active toggle.
- `Generate Code` button: select a member from a search dropdown, click generate.

### 5.6 New hooks

| Hook | Purpose |
|------|---------|
| `useLoyaltyMembership.js` | `GET /loyalty/memberships/`, create, adjust, redeem mutations |
| `useLoyaltyTiers.js` | CRUD for tiers |
| `useReferralCodes.js` | CRUD for referral codes and uses |
| `useDebtChase.js` | Notes, dunning, escalation for a member (see §5.3) |
| `useDunningTemplates.js` | GET and PUT for dunning letter templates |
| `useSurveys.js` | NPS summary + response list |
| `useDuplicateFlags.js` | Flag list, merge, dismiss |
| `useLeadScores.js` | Lead list with scores |
| `useSecondaryContacts.js` | CRUD for vessel secondary contacts |

All hooks follow the existing pattern: React Query + Axios, toast on mutation success/error, invalidate query key on mutation.

---

## 6. Implementation Steps (ordered)

Steps respect Django migration dependencies. Do not reorder steps 1–6.

1. **Add `is_archived` field to `Member`** — `BooleanField(default=False)`. Write and run migration.

2. **Add `members` app models** — Add `DuplicateFlag`, `SecondaryContact`, `LeadScore`, `SurveyResponse` to `members/models.py`. Write and run migration.

3. **Add `billing` app models** — Add `DunningTemplate`, `DebtNote`, `DunningLetter`, `DebtEscalation` to `billing/models.py`. Write and run migration.

4. **Create `loyalty` app** — `startapp loyalty`. Define all four models. Write and run migration. Register in `INSTALLED_APPS`.

5. **Add fields to `Marina` model** (`accounts` app) — `points_earn_rate`, `points_to_currency_ratio`, four referral benefit fields, and `harbour_master_email`. Write and run migration.

6. **Serializers and ViewSets** — one per new model. Register all new routes in `urls.py`. No business logic in serializers; logic goes in service functions in `<app>/services.py`.

7. **Duplicate detection service** — `members/services.py`: `check_for_duplicates(marina, name, email, phone, vessel_name)`. Implements the three deterministic rules:
   - Rule 1: exact email match (case-insensitive).
   - Rule 2: exact phone match (normalised E.164).
   - Rule 3: exact vessel name match AND `difflib.SequenceMatcher(name_a, name_b).ratio() >= 0.85`.
   Fuzzy name-only matching is not implemented. Creates `DuplicateFlag` with `match_rule` set accordingly. Called from `MemberViewSet.create()` after the record is saved.

8. **Merge service** — `members/services.py`: `merge_members(flag, keep_member_id, resolved_by)`. Runs in a database transaction. Re-assigns all related records as described in §4.1.

9. **Lead score management command** — `members/management/commands/recalculate_lead_scores.py`. Iterates all marina `Member` records where no confirmed `Booking` of any kind exists (never-booked). Excludes members who have historical confirmed bookings. Computes composite score from `LeadScore` signal fields. Upserts `LeadScore` record.

10. **Survey trigger management command** — `members/management/commands/send_checkout_surveys.py`. Finds `Booking` records where `status = 'checked_out'`, `check_out` is between 23 and 25 hours ago, and no `SurveyResponse` exists. Generates signed token via `django.core.signing.TimestampSigner`. Sends survey email. Intended to run every hour via Celery beat or OS cron.

11. **NPS alert signal** — In `SurveyResponse` post-save signal: if `nps_score <= 6` and `alert_sent = False`, send alert email to `marina.harbour_master_email` and set `alert_sent = True`.

12. **Loyalty discount application** — `loyalty/services.py`: `apply_tier_discount(booking, invoice)`. Looks up the member's `LoyaltyMembership`, reads the tier's `berth_discount_pct`, calculates the discount amount from the berth fee line item, creates a negative `InvoiceLineItem` linked to the loyalty `ChargeableItem`. Called from the booking finalization flow.

13. **Points earn service** — `loyalty/services.py`: `earn_points(membership, invoice)`. Calculates `points = int(invoice_total * marina.points_earn_rate * tier.points_multiplier)`. Called from billing's `Invoice` post-`paid` signal. Creates a `PointsLedger` entry with type `EARN`. Updates `membership.last_activity_at = now()` (one field, one row — never touches historical ledger entries).

    **Point and credit balance mutations MUST use `select_for_update()` to prevent race conditions from concurrent redemptions.** All functions that increment or decrement `LoyaltyMembership.points_balance` must lock the row first:
    ```python
    from django.db import transaction

    with transaction.atomic():
        membership = LoyaltyMembership.objects.select_for_update().get(pk=membership_pk)
        # safe to read and write membership.points_balance here
    ```
    The same pattern applies to any `MemberCreditAccount.balance` mutations (Track 4 credit wallet): always acquire a row-level lock with `select_for_update()` inside an atomic block before reading or writing the balance. This prevents double-spend and phantom negative balances when a member triggers two concurrent redemptions (e.g. double-tapping the "Redeem" button in the portal).

    **Do not** set `expires_at` on ledger entries or run any bulk `UPDATE` against existing `PointsLedger` rows. A 10-year member can have thousands of EARN rows; updating all of them on every ice bag sale causes table-level lock contention and POS checkout latency. The inactivity clock lives only on `LoyaltyMembership.last_activity_at`.

14. **Points expiry management command** — `loyalty/management/commands/expire_points.py`. Runs nightly. Queries `LoyaltyMembership` where `last_activity_at < now() - timedelta(days=730)` and `points_balance > 0`. For each such membership, inserts a single `PointsLedger` entry of type `EXPIRE` with `points = -membership.points_balance` and `balance_after = 0`, then zeroes `membership.points_balance`. Sends reminder email to members whose `last_activity_at` is between 24 and 25 months ago (30-day warning window) — determined by a separate query before the hard expiry query runs.

15. **Tier promotion service** — `loyalty/services.py`: `evaluate_tier(membership)`. Called after every `earn_points` call. Compares `lifetime_spend` / `qualifying_stays` / membership years against all `LoyaltyTier` thresholds for the marina. If a higher tier is reached, updates `membership.tier`, sets `tier_achieved_at = now()`, and sends a congratulatory email to the member. The email body: "Congratulations, you are now a [tier name] member at [marina name]. Enjoy your new [discount]% berth discount."

16. **Dunning PDF generation** — `billing/services.py`: `generate_dunning_letter(member, invoice_ids, level, send_via, generated_by)`. Computes two distinct figures before rendering:
    - `demand_amount`: `Invoice.objects.filter(pk__in=invoice_ids).aggregate(Sum('total'))['total__sum']`
    - `total_account_balance`: `Invoice.objects.filter(member=member, status='overdue').aggregate(Sum('total'))['total__sum']`

    Both are stored on the `DunningLetter` record (separate fields) and passed as separate template variables. Looks up the marina's `DunningTemplate` for the given level (falls back to built-in default template if none exists). Renders the body by substituting `{{variable}}` placeholders — `{{demand_amount}}` substitutes the selected-invoices sum only; `{{total_account_balance}}` substitutes the full account balance. Uses WeasyPrint with a marina-branded HTML wrapper (`billing/templates/billing/dunning_letter.html`). Stores PDF on `DunningLetter.pdf_document`.

17. **Referral benefit application** — `loyalty/services.py`: `apply_referral_benefits(referral_use)`. Called from `BookingEngineRequestView` when a referral code is supplied.

    **Net-new customer gate (run before applying any benefit):** assert that `referee_member` has zero `Booking` records with `status IN ('confirmed', 'checked_out')` across all marinas. If the check fails, set `ReferralUse.benefit_status = 'rejected'` and return `400 Bad Request` with `{"error": "referral_existing_customer", "detail": "Referral codes are valid for first-time customers only."}`. This blocks:
    - Mutual referral rings (A refers B, B refers A).
    - Existing customers finding codes on social media and applying them for an instant discount.

    If the gate passes: immediately apply the referee discount as a negative `InvoiceLineItem`. Then check `booking.total >= 50.00` (minimum qualifying spend). If yes, issue the referrer benefit (points or discount line item) and set `ReferralUse.benefit_status = 'applied'`. If no, leave status as `pending` until a qualifying booking is completed.

18. **Frontend — Members screen tabs** — Add `Loyalty` and `Leads` tabs, `MemberLoyaltyTab.jsx`, `LeadScoringTab.jsx` (labelled "Unconverted Leads"), loyalty row in member detail panel, duplicate flag banner.

19. **Frontend — Vessel contacts panel** — `VesselContactsPanel.jsx`, `ContactFormModal.jsx` (with cc_owner field), `useSecondaryContacts.js`.

20. **Frontend — Billing debt chase drawer** — Wire existing "Chase" button to `DebtChaseDrawer.jsx`, `useDebtChase.js`.

21. **Frontend — Dunning template editor** — Add "Letter Templates" section to Billing Settings. `DunningTemplateModal.jsx`, `useDunningTemplates.js`.

22. **Frontend — Customer Intelligence screen** — `CustomerIntelligenceScreen.jsx` with NPS and duplicate flags tabs. Merge modal shows pre-selected canonical record. Add to "Master Data" sidebar group.

23. **Frontend — Loyalty config screen** — `LoyaltyConfigScreen.jsx`, `TierFormDrawer.jsx`, global earn rate and conversion ratio fields. Add to "Master Data" sidebar group.

24. **Frontend — Loyalty hooks** — All hooks listed in §5.6.

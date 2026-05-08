# Track 7 — Communications, Marketing & OTA Distribution: Design Spec
Date: 2026-05-07
Scope: New `communications` Django app + extensions to `reports`, `reservations`, and `portal` — covering WhatsApp Business API, multi-channel journey automation, Slack/Teams alert routing, a generic marketing automation adapter (Dotdigital as first implementation), A/B email testing, lead conversion funnel, multi-site comparison dashboard, automated review solicitation with pre-screen gating, coupon codes, OTA channel manager (Dockwa first, then PitchUp, Snag-A-Slip, Rentals United), and an embeddable JS booking widget with Stripe Elements.

> Spec status: Final — reviewed 2026-05-08

---

## 1. Architectural Goal

Track 7 delivers the outbound communications and distribution layer that makes DocksBase competitive with Dockwa, Storable Marine, and EliteMarinas. The architecture has four distinct pillars:

**Pillar A — Communications engine.** A new `communications` Django app owns all channel-aware message dispatch. It wraps the existing Anymail/Resend email path, adds a WhatsApp Business API adapter, formalises the SMS stub into a real provider, and provides a unified `MessageLog` table so every outbound and inbound message is auditable regardless of channel.

**Pillar B — Automation engine.** A `Journey` model (step chain + per-step condition) drives all timed, multi-channel campaigns. Celery Beat evaluates step eligibility every 15 minutes. The journey builder is a full visual no-code canvas built with ReactFlow.

**Pillar C — OTA distribution layer.** An adapter pattern decouples DocksBase availability data from each OTA's API contract. Each OTA gets its own adapter class. Availability is pushed via **two complementary mechanisms**: (1) a real-time event-driven delta sync triggered by a `post_save` signal on `Booking` whenever a booking transitions to `confirmed` or `cancelled`, and (2) a 30-minute batch self-healing full-calendar push as a fallback. The delta sync is the primary path — a 30-minute polling window is fatal for high-demand marinas where the last berth for a peak date can be double-booked within minutes. New reservations are pulled via webhook (preferred) or polling fallback. Dockwa is built first.

**Pillar D — Booking widget.** A server-rendered JS bundle hosted by DocksBase, embeddable as a single `<script>` tag on any marina website. The widget uses Stripe Elements to keep the boater inside the iframe throughout the payment flow. **The widget booking flow is completely stateless — it never relies on Django session cookies.** Safari ITP and Chrome's third-party cookie deprecation will silently block any session cookie set by `widget.docksbase.com` when it is embedded inside `examplemarina.com`. Instead, when the boater starts a booking, the backend returns a signed `booking_token` (JWT) containing cart state (marina, dates, berth category, add-ons). The widget stores this token in memory (or `localStorage`) and sends it as `Authorization: Bearer <booking_token>` on every subsequent step. No session cookie is required at any stage of the wizard.

All models carry the standard `marina = ForeignKey('accounts.Marina')` multi-tenancy FK.

---

## 2. Data Models

All models below live in a new `backend/apps/communications/` app unless noted.

### 2.1 MessageLog — unified outbound/inbound record

```python
class MessageLog(models.Model):
    class Channel(models.TextChoices):
        EMAIL     = 'email',     'Email'
        SMS       = 'sms',       'SMS'
        WHATSAPP  = 'whatsapp',  'WhatsApp'
        SLACK     = 'slack',     'Slack'
        TEAMS     = 'teams',     'Microsoft Teams'

    class Direction(models.TextChoices):
        OUTBOUND = 'out', 'Outbound'
        INBOUND  = 'in',  'Inbound'

    class Status(models.TextChoices):
        QUEUED    = 'queued',    'Queued'
        SENT      = 'sent',      'Sent'
        DELIVERED = 'delivered', 'Delivered'
        READ      = 'read',      'Read'
        FAILED    = 'failed',    'Failed'
        RECEIVED  = 'received',  'Received'   # inbound only

    marina     = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    member     = models.ForeignKey('members.Member', null=True, blank=True, on_delete=models.SET_NULL)
    booking    = models.ForeignKey('reservations.Booking', null=True, blank=True, on_delete=models.SET_NULL)
    journey_step = models.ForeignKey('JourneyStep', null=True, blank=True, on_delete=models.SET_NULL)

    channel    = models.CharField(max_length=20, choices=Channel.choices)
    direction  = models.CharField(max_length=3, choices=Direction.choices, default=Direction.OUTBOUND)
    status     = models.CharField(max_length=20, choices=Status.choices, default=Status.QUEUED)

    recipient  = models.CharField(max_length=500)   # email addr, phone, WhatsApp number, channel webhook URL
    subject    = models.CharField(max_length=500, blank=True)
    body       = models.TextField(blank=True)

    provider_message_id = models.CharField(max_length=200, blank=True)  # Resend/Meta/Twilio message ID
    sent_at    = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    read_at    = models.DateTimeField(null=True, blank=True)
    failed_reason = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['marina', 'channel', 'status']),
            models.Index(fields=['marina', 'member']),
        ]
```

### 2.2 WhatsAppTemplate — Meta-approved message templates

```python
class WhatsAppTemplate(models.Model):
    class Status(models.TextChoices):
        DRAFT    = 'draft',    'Draft'
        PENDING  = 'pending',  'Pending Meta Approval'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    name          = models.CharField(max_length=200)   # e.g. "booking_confirmation_v1"
    meta_name     = models.CharField(max_length=200, blank=True)  # template name registered in Meta Business Manager
    language_code = models.CharField(max_length=10, default='en')
    category      = models.CharField(max_length=50)    # Meta category: UTILITY / MARKETING / AUTHENTICATION
    body_text     = models.TextField()                 # template body with {{1}} placeholders
    header_text   = models.CharField(max_length=500, blank=True)
    footer_text   = models.CharField(max_length=200, blank=True)
    status        = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    meta_template_id = models.CharField(max_length=200, blank=True)
    rejection_reason = models.TextField(blank=True)
    created_at    = models.DateTimeField(auto_now_add=True)
    updated_at    = models.DateTimeField(auto_now=True)
```

### 2.3 Journey, JourneyStep, JourneyEnrollment

```python
class Journey(models.Model):
    class TriggerEvent(models.TextChoices):
        BOOKING_CONFIRMED   = 'booking_confirmed',   'Booking Confirmed'
        BOOKING_CHECKOUT    = 'booking_checkout',    'Guest Checked Out'
        RENEWAL_DUE         = 'renewal_due',         'Annual Renewal Due'
        INSURANCE_EXPIRING  = 'insurance_expiring',  'Insurance Expiring'
        INVOICE_OVERDUE     = 'invoice_overdue',     'Invoice Overdue'
        DOCUMENT_UNSIGNED   = 'document_unsigned',   'Document Unsigned'
        MANUAL              = 'manual',              'Manual Trigger'

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    name        = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    trigger     = models.CharField(max_length=50, choices=TriggerEvent.choices)
    is_active   = models.BooleanField(default=False)
    created_at  = models.DateTimeField(auto_now_add=True)


class JourneyStep(models.Model):
    class Channel(models.TextChoices):
        EMAIL    = 'email',    'Email'
        SMS      = 'sms',     'SMS'
        WHATSAPP = 'whatsapp','WhatsApp'
        TASK     = 'task',    'Staff Task'  # creates a maintenance.Task record

    class StepType(models.TextChoices):
        ACTION = 'action', 'Action — fire and advance'
        GATE   = 'gate',   'Gate — wait until condition is True'
        # ACTION: condition is evaluated; if False, step is skipped and enrollment advances.
        # GATE:   condition is evaluated; if False, enrollment stays parked on this step.
        #         The gate re-evaluates every time evaluate_journey_steps runs (every 15 min)
        #         until the condition becomes True OR gate_timeout_days elapses.
        #         On timeout: step logged as gate_timed_out=True and enrollment advances.
        #         Example: "Wait until Invoice Paid" — a False evaluation means the boater
        #         hasn't paid yet. Do NOT skip this step; park here and check again later.

    class ConditionField(models.TextChoices):
        PREVIOUS_STEP_OPENED  = 'prev_opened',    'Previous Step Opened'
        PREVIOUS_STEP_CLICKED = 'prev_clicked',   'Previous Step Clicked'
        BOOKING_STATUS        = 'booking_status', 'Booking Status'
        DOCUMENT_SIGNED       = 'document_signed','Document Signed'
        INVOICE_PAID          = 'invoice_paid',   'Invoice Paid'
        NONE                  = 'none',            'Always Fire'

    journey     = models.ForeignKey(Journey, on_delete=models.CASCADE, related_name='steps')
    order       = models.PositiveSmallIntegerField()   # 1, 2, 3…

    step_type   = models.CharField(max_length=10, choices=StepType.choices, default=StepType.ACTION,
                                   help_text='ACTION = fire/skip and advance; GATE = wait until condition True')
    gate_timeout_days = models.IntegerField(default=7,
                                            help_text='Gate steps only: max days to wait before timing out and advancing')

    channel     = models.CharField(max_length=20, choices=Channel.choices)
    delay_unit  = models.CharField(max_length=10, choices=[('minutes','Minutes'),('hours','Hours'),('days','Days')])
    delay_value = models.IntegerField(default=0)  # offset from trigger or previous step

    # Condition evaluated before firing this step
    condition_field    = models.CharField(max_length=40, choices=ConditionField.choices, default=ConditionField.NONE)
    condition_operator = models.CharField(max_length=10, choices=[('eq','='),('neq','!=')], blank=True)
    condition_value    = models.CharField(max_length=200, blank=True)

    # Content
    subject        = models.CharField(max_length=500, blank=True)   # email only
    body_template  = models.TextField(blank=True)   # Jinja2 template string
    whatsapp_template = models.ForeignKey(WhatsAppTemplate, null=True, blank=True, on_delete=models.SET_NULL)
    task_title     = models.CharField(max_length=300, blank=True)   # channel=task only

    class Meta:
        ordering = ['journey', 'order']
        unique_together = [('journey', 'order')]


class JourneyEnrollment(models.Model):
    class Status(models.TextChoices):
        ACTIVE    = 'active',    'Active'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'
        FAILED    = 'failed',    'Failed'

    marina    = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    journey   = models.ForeignKey(Journey, on_delete=models.CASCADE, related_name='enrollments')
    member    = models.ForeignKey('members.Member', null=True, blank=True, on_delete=models.SET_NULL)
    booking   = models.ForeignKey('reservations.Booking', null=True, blank=True, on_delete=models.SET_NULL)
    status    = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    current_step_order = models.PositiveSmallIntegerField(default=1)
    enrolled_at = models.DateTimeField(auto_now_add=True)
    next_step_due_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)


class JourneyStepLog(models.Model):
    """
    One record per step fired (or skipped/timed-out) per enrollment.
    For GATE steps: no log is written while the gate is waiting — the enrollment simply
    stays parked on that step. A log is written only when the gate opens (condition True)
    or times out (gate_timed_out=True).
    """
    enrollment      = models.ForeignKey(JourneyEnrollment, on_delete=models.CASCADE, related_name='step_logs')
    step            = models.ForeignKey(JourneyStep, on_delete=models.CASCADE)
    message_log     = models.ForeignKey(MessageLog, null=True, blank=True, on_delete=models.SET_NULL)
    skipped         = models.BooleanField(default=False)   # True for ACTION steps where condition was False
    skip_reason     = models.CharField(max_length=200, blank=True)
    gate_timed_out  = models.BooleanField(default=False)   # True when a GATE step exceeded gate_timeout_days
    fired_at        = models.DateTimeField(auto_now_add=True)
```

### 2.4 AlertRoute — Slack/Teams alert routing config

```python
class AlertRoute(models.Model):
    class Platform(models.TextChoices):
        SLACK = 'slack', 'Slack'
        TEAMS = 'teams', 'Microsoft Teams'

    class AlertType(models.TextChoices):
        NEW_BOOKING      = 'new_booking',      'New Booking Received'
        PAYMENT_FAILURE  = 'payment_failure',  'Payment Failure'
        CRITICAL_DEFECT  = 'critical_defect',  'Critical Defect Logged'
        STOCK_LOW        = 'stock_low',        'Stock Below Minimum'
        OVERSTAY         = 'overstay',         'Overstay Detected'
        REVIEW_NEGATIVE  = 'review_negative',  'Negative Review Received'

    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    platform     = models.CharField(max_length=10, choices=Platform.choices)
    alert_type   = models.CharField(max_length=40, choices=AlertType.choices)
    webhook_url  = models.URLField()
    channel_name = models.CharField(max_length=200, blank=True)  # descriptive label e.g. "#finance"
    is_active    = models.BooleanField(default=True)
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'platform', 'alert_type')]
```

### 2.5 MarketingAutomationConfig / DotdigitalConfig — generic adapter with Dotdigital as first implementation

The marketing automation integration follows the same adapter pattern used for accounting and OTA channels. A `MarketingAutomationAdapter` base class in `communications/marketing/base.py` defines the interface. Dotdigital is the first concrete implementation. Mailchimp and Klaviyo can be added later with no rework to callers.

```python
class DotdigitalConfig(models.Model):
    marina          = models.OneToOneField('accounts.Marina', on_delete=models.CASCADE, related_name='dotdigital_config')
    api_username    = models.CharField(max_length=200)
    api_password    = models.CharField(max_length=200)   # store encrypted via django-fernet-fields or env vault
    region          = models.CharField(max_length=10, default='r1')  # r1/r2/r3 Dotdigital regions
    address_book_id = models.CharField(max_length=50, blank=True)    # default Dotdigital address book
    last_sync_at    = models.DateTimeField(null=True, blank=True)
    sync_enabled    = models.BooleanField(default=False)


class DotdigitalSegmentMapping(models.Model):
    """Maps a DocksBase Segment to a Dotdigital address book."""
    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    segment          = models.ForeignKey('members.Segment', on_delete=models.CASCADE)
    dotdigital_book_id = models.CharField(max_length=50)
    last_sync_at     = models.DateTimeField(null=True, blank=True)
    last_sync_count  = models.IntegerField(default=0)
```

### 2.6 EmailCampaign + ABTest — bulk sends with A/B support

A/B test winner action defaults to `AUTO_SEND`. The system evaluates statistical significance (open/click rate) after the hold period elapses and fires the winning variant automatically. Marina managers are not required to log back in to approve.

```python
class EmailCampaign(models.Model):
    class Status(models.TextChoices):
        DRAFT     = 'draft',     'Draft'
        SCHEDULED = 'scheduled', 'Scheduled'
        SENDING   = 'sending',   'Sending'
        SENT      = 'sent',      'Sent'
        CANCELLED = 'cancelled', 'Cancelled'

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    name        = models.CharField(max_length=200)
    segment     = models.ForeignKey('members.Segment', null=True, blank=True, on_delete=models.SET_NULL)
    status      = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    scheduled_at = models.DateTimeField(null=True, blank=True)
    sent_at     = models.DateTimeField(null=True, blank=True)
    total_sent  = models.IntegerField(default=0)
    created_at  = models.DateTimeField(auto_now_add=True)


class EmailCampaignVariant(models.Model):
    """One campaign has 1 (no A/B) or 2 (A/B) variants."""
    campaign    = models.ForeignKey(EmailCampaign, on_delete=models.CASCADE, related_name='variants')
    label       = models.CharField(max_length=1)       # 'A' or 'B'
    subject     = models.CharField(max_length=500)
    body_html   = models.TextField()
    split_pct   = models.IntegerField(default=100)     # % of audience to receive this variant (test: 20 each)
    sent_count  = models.IntegerField(default=0)
    open_count  = models.IntegerField(default=0)
    click_count = models.IntegerField(default=0)
    open_rate   = models.DecimalField(max_digits=5, decimal_places=2, default=0)   # computed on webhook receipt


class ABTest(models.Model):
    class WinnerMetric(models.TextChoices):
        OPEN_RATE  = 'open_rate',  'Open Rate'
        CLICK_RATE = 'click_rate', 'Click Rate'

    class WinnerAction(models.TextChoices):
        AUTO_SEND = 'auto_send', 'Auto-send winner to remainder'
        ALERT     = 'alert',     'Alert manager — manual approval required'

    campaign        = models.OneToOneField(EmailCampaign, on_delete=models.CASCADE, related_name='ab_test')
    test_split_pct  = models.IntegerField(default=20)    # % for each variant (20 = 20%A + 20%B + 60% held)
    hold_hours      = models.IntegerField(default=4)     # how long to wait before picking winner
    winner_metric   = models.CharField(max_length=20, choices=WinnerMetric.choices, default=WinnerMetric.OPEN_RATE)
    winner_action   = models.CharField(max_length=20, choices=WinnerAction.choices, default=WinnerAction.AUTO_SEND)
    winner_variant  = models.ForeignKey(EmailCampaignVariant, null=True, blank=True, on_delete=models.SET_NULL, related_name='won_tests')
    winner_sent_at  = models.DateTimeField(null=True, blank=True)
```

### 2.7 ReviewRequest — automated solicitation with pre-screen gating

Review solicitation uses a "review gating" pre-screen. The initial email asks the guest to rate their stay 1–5. Guests who click 4 or 5 are immediately redirected to the public review platform (Google Business Profile, TripAdvisor). Guests who click 1, 2, or 3 are redirected to a private DocksBase feedback form; on submission, an `AlertRoute(alert_type='review_negative')` fires to notify the harbour master via Slack/Teams, enabling staff to intercept the dissatisfied boater before a public negative review is posted.

```python
class ReviewRequest(models.Model):
    class Platform(models.TextChoices):
        GOOGLE      = 'google',      'Google Business Profile'
        TRIPADVISOR = 'tripadvisor', 'TripAdvisor'
        DOCKWA      = 'dockwa',      'Dockwa'

    class Status(models.TextChoices):
        SENT      = 'sent',      'Sent'
        OPENED    = 'opened',    'Opened'
        CLICKED   = 'clicked',   'Clicked (review link)'
        RESPONDED = 'responded', 'Responded'

    marina    = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    booking   = models.ForeignKey('reservations.Booking', on_delete=models.CASCADE)
    member    = models.ForeignKey('members.Member', null=True, blank=True, on_delete=models.SET_NULL)
    platform  = models.CharField(max_length=20, choices=Platform.choices)
    status    = models.CharField(max_length=20, choices=Status.choices, default=Status.SENT)
    sent_at   = models.DateTimeField(auto_now_add=True)
    opened_at = models.DateTimeField(null=True, blank=True)
    clicked_at = models.DateTimeField(null=True, blank=True)


class ReviewConfig(models.Model):
    """Per-marina review solicitation settings."""
    marina              = models.OneToOneField('accounts.Marina', on_delete=models.CASCADE, related_name='review_config')
    enabled             = models.BooleanField(default=False)
    delay_hours         = models.IntegerField(default=24)   # hours after checkout to send
    google_review_url   = models.URLField(blank=True)
    tripadvisor_review_url = models.URLField(blank=True)
    dockwa_review_url   = models.URLField(blank=True)
    send_channel        = models.CharField(max_length=20, choices=[('email','Email'),('sms','SMS')], default='email')
    negative_threshold  = models.IntegerField(default=3)    # ratings <= this value trigger private feedback form
```

### 2.8 CouponCode — promotional discounts (lives in `billing` app)

```python
# backend/apps/billing/models.py — add to existing file

class CouponCode(models.Model):
    class DiscountType(models.TextChoices):
        PERCENTAGE = 'pct',   'Percentage'
        FIXED      = 'fixed', 'Fixed Amount'

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    code            = models.CharField(max_length=50)    # e.g. "SUMMER20"
    description     = models.CharField(max_length=300, blank=True)
    discount_type   = models.CharField(max_length=10, choices=DiscountType.choices)
    discount_value  = models.DecimalField(max_digits=8, decimal_places=2)   # % or currency amount
    applicable_categories = models.JSONField(default=list)   # list of ChargeableItem categories, empty = all
    minimum_stay_nights   = models.IntegerField(default=0)   # 0 = no minimum
    valid_from      = models.DateField()
    valid_until     = models.DateField()
    max_uses        = models.IntegerField(null=True, blank=True)  # null = unlimited
    uses_count      = models.IntegerField(default=0)
    is_active       = models.BooleanField(default=True)
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'code')]

    def is_valid(self):
        """
        Pre-validation check for cart display only — do NOT use this to gate invoice creation.

        This method reads uses_count without a database lock. Under concurrent checkout load
        (e.g. 30 users on the checkout screen simultaneously), all 30 may see uses_count < max_uses
        and pass this check, leading to over-redemption.

        At invoice finalization, always enforce the limit via a pessimistic lock:
            with transaction.atomic():
                coupon = CouponCode.objects.select_for_update().get(pk=self.pk)
                if coupon.max_uses is not None and coupon.uses_count >= coupon.max_uses:
                    raise CouponExhausted(...)
                coupon.uses_count += 1
                coupon.save(update_fields=['uses_count'])

        is_valid() is safe for UI feedback (availability indicator, cart preview).
        It is NOT safe as the authoritative redemption gate.
        """
        from django.utils import timezone
        today = timezone.now().date()
        if not self.is_active:
            return False
        if today < self.valid_from or today > self.valid_until:
            return False
        if self.max_uses is not None and self.uses_count >= self.max_uses:
            return False
        return True


class CouponRedemption(models.Model):
    coupon   = models.ForeignKey(CouponCode, on_delete=models.CASCADE, related_name='redemptions')
    booking  = models.ForeignKey('reservations.Booking', on_delete=models.CASCADE)
    discount_applied = models.DecimalField(max_digits=8, decimal_places=2)
    redeemed_at = models.DateTimeField(auto_now_add=True)
```

### 2.9 OTA Channel Manager (lives in new `channels` app)

Dockwa is built first (highest US market demand). PitchUp is second (UK/EU crossover). Snag-A-Slip and Rentals United follow.

OTA commission amounts are tracked separately from the booking invoice — they are never deducted from the booking total. The marina's gross revenue figure remains unaffected. Commission is reported as a deduction line in the channel performance report (GAAP/IFRS gross revenue model).

```python
# backend/apps/channels/models.py

class OTAChannel(models.Model):
    class Provider(models.TextChoices):
        RENTALS_UNITED = 'rentals_united', 'Rentals United'
        PITCHUP        = 'pitchup',        'PitchUp'
        SNAG_A_SLIP    = 'snag_a_slip',    'Snag-A-Slip'
        DOCKWA         = 'dockwa',         'Dockwa'
        MYSEA          = 'mysea',          'MySea'
        NOFOREIGNLAND  = 'noforeignland',  'Noforeignland'

    marina    = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    provider  = models.CharField(max_length=40, choices=Provider.choices)
    is_active = models.BooleanField(default=False)

    # API credentials encrypted at rest.
    # from fernet_fields import EncryptedCharField
    api_key        = EncryptedCharField(max_length=255)
    api_secret     = EncryptedCharField(max_length=255)
    property_id    = models.CharField(max_length=200, blank=True)   # OTA's ID for this marina

    # Pricing policy for this channel
    class PricingPolicy(models.TextChoices):
        PARITY   = 'parity',  'Rate Parity (same as direct)'
        MARKUP   = 'markup',  'Fixed Markup (%)'
        DISCOUNT = 'discount','Fixed Discount (%)'

    pricing_policy  = models.CharField(max_length=20, choices=PricingPolicy.choices, default=PricingPolicy.PARITY)
    pricing_delta_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0)  # +/- %

    last_push_at   = models.DateTimeField(null=True, blank=True)
    last_pull_at   = models.DateTimeField(null=True, blank=True)
    created_at     = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'provider')]


class OTABooking(models.Model):
    """Maps an OTA reservation to an internal Booking once imported."""
    channel      = models.ForeignKey(OTAChannel, on_delete=models.CASCADE, related_name='ota_bookings')
    booking      = models.OneToOneField('reservations.Booking', null=True, blank=True, on_delete=models.SET_NULL)
    ota_ref      = models.CharField(max_length=200)   # OTA's own booking reference
    raw_payload  = models.JSONField(default=dict)      # original OTA payload archived for debugging
    commission_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    commission_amount = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    # commission_amount is tracked for reporting only; it is NOT deducted from the booking invoice.
    # Gross revenue = booking.total; commission = marketing expense shown separately in channel reports.
    imported_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('channel', 'ota_ref')]
        # OTA webhook retries can deliver the same booking event multiple times.
        # This constraint makes the webhook handler idempotent: a duplicate delivery
        # for the same (channel, ota_ref) pair raises IntegrityError, which the handler
        # catches and ignores, preventing duplicate Booking records.
```

### 2.10 BookingWidgetConfig — per-marina widget settings

```python
# backend/apps/portal/models.py — add to existing file

class BookingWidgetConfig(models.Model):
    marina          = models.OneToOneField('accounts.Marina', on_delete=models.CASCADE, related_name='widget_config')
    is_enabled      = models.BooleanField(default=False)
    primary_color   = models.CharField(max_length=7, default='#1a3a5c')   # hex
    button_text     = models.CharField(max_length=100, default='Check Availability')
    logo_url        = models.URLField(blank=True)   # CDN URL for marina logo override
    show_extras     = models.JSONField(default=list)  # ['electricity', 'water', 'parking', 'provisioning']
    allowed_origins = models.JSONField(default=list)  # CORS allowlist for the widget script
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)
```

### 2.11 MarinaGroup — multi-site access control

Multi-site access is scoped to named marina groups (e.g. "MGM Marinas"). A simple `group_access` boolean on `User` is insufficient — it would grant visibility across all marinas on the SaaS platform, which is a security flaw. Instead, marinas belong to a `MarinaGroup` and users are granted access via a `MarinaGroupMembership` with a role. Multi-site comparison reports are scoped to the user's group.

```python
# backend/apps/accounts/models.py — add to existing file

class MarinaGroup(models.Model):
    name       = models.CharField(max_length=200)
    slug       = models.SlugField(unique=True)
    created_at = models.DateTimeField(auto_now_add=True)


class MarinaGroupMembership(models.Model):
    """Links a Marina to a MarinaGroup."""
    group  = models.ForeignKey(MarinaGroup, on_delete=models.CASCADE, related_name='memberships')
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='group_memberships')

    class Meta:
        unique_together = [('group', 'marina')]


class MarinaGroupUserRole(models.Model):
    """Grants a User access to all marinas within a MarinaGroup."""
    class Role(models.TextChoices):
        VIEWER = 'viewer', 'Viewer'
        ADMIN  = 'admin',  'Admin'

    group = models.ForeignKey(MarinaGroup, on_delete=models.CASCADE, related_name='user_roles')
    user  = models.ForeignKey('accounts.User', on_delete=models.CASCADE, related_name='group_roles')
    role  = models.CharField(max_length=20, choices=Role.choices, default=Role.VIEWER)

    class Meta:
        unique_together = [('group', 'user')]
```

---

## 3. WhatsApp Integration Architecture

### 3.1 Provider: Meta Cloud API (preferred) or 360dialog

Meta Cloud API is the direct path (no intermediary fee). 360dialog is an approved BSP (Business Solution Provider) with a simpler onboarding if Meta's direct application is too slow. The adapter interface is the same regardless; the provider is swapped via the `WHATSAPP_PROVIDER` env var.

WhatsApp is an Enterprise-tier feature. Each marina on the Enterprise plan receives 500 free WhatsApp conversations per month. Usage beyond this is billed at €0.05 per conversation via Stripe Metered Billing. The entitlement check runs in the dispatch adapter before sending; marinas on lower tiers receive a `WhatsAppNotEntitled` error, logged as `MessageLog(status='failed')`.

```
META CLOUD API
  ↑ ↓
WhatsAppAdapter (communications/adapters/whatsapp.py)
  │  send_template(to_number, template_name, language, variables)
  │  send_text(to_number, body)         ← session messages only (within 24h window)
  ↓
MessageLog (channel='whatsapp', direction='out')
```

### 3.2 Inbound messages — webhook receiver

Meta sends inbound messages and delivery status updates to a webhook URL:

```
POST /api/v1/communications/whatsapp/webhook/
```

The view:
1. Verifies the `X-Hub-Signature-256` header using `WHATSAPP_VERIFY_TOKEN`.
2. Routes by `entry[0].changes[0].value.messages[0].type`:
   - `text` → create `MessageLog(direction='in', channel='whatsapp', body=message.text.body)`
   - `statuses` → update the matching outbound `MessageLog.status` (delivered, read, failed)
3. Dispatches a Django signal `whatsapp_message_received` so other apps (journeys, unified inbox) can react.

### 3.3 Template approval flow

```
Manager creates WhatsAppTemplate (status=draft)
→ POST /api/v1/communications/whatsapp/templates/{id}/submit/
  → adapter.submit_template_for_approval(template)
  → Meta returns template_id, status=pending
→ Meta webhook fires template status update (approved/rejected)
  → POST /api/v1/communications/whatsapp/webhook/ (status_update)
  → WhatsAppTemplate.status updated; rejection_reason stored
→ Approved template becomes selectable in Journey step builder
```

### 3.4 Consent requirement

WhatsApp messaging requires explicit opt-in under Meta policy and GDPR. The `Member` model gains a `whatsapp_opt_in = models.BooleanField(default=False)` field.

**Primary consent path — boater portal / booking widget.** A checkbox is presented at the Stripe checkout step: "Send my confirmation and gate codes via WhatsApp." Checking this box sets `whatsapp_opt_in=True` and records the consent timestamp.

**Secondary consent path — staff-recorded walk-in consent.** If a harbour master obtains verbal or written consent from a walk-in boater, they may check the opt-in box on the member record in the back-office. In this case the system automatically logs the `StaffMember` ID and timestamp of who performed the override, creating an immutable audit record.

The dispatch adapter checks the `whatsapp_opt_in` flag and raises `WhatsAppOptInRequired` if `False`; the calling code logs a `MessageLog(status='failed', failed_reason='No WhatsApp opt-in')` and continues.

### 3.5 Unified inbox (future scope — noted, not specced here)

A unified inbox screen showing inbound WhatsApp + email + SMS threads is a logical follow-on. It is architecturally enabled by the `MessageLog` table but is not part of this spec.

---

## 4. Journey Builder Architecture

The journey builder is the most complex feature in Track 7. It combines a visual no-code canvas editor (frontend, built with ReactFlow) with a Celery-driven step evaluator (backend). A template-based simplified UI is not built — the full canvas is shipped in v1.

### 4.1 Journey execution engine (backend)

```
Trigger fires (Django signal or Celery task)
  → JourneyEnrollment created (status=active, current_step_order=1, next_step_due_at=now+step1.delay)

Celery Beat task: evaluate_journey_steps (every 15 minutes)
  → fetch all JourneyEnrollments where status=active AND next_step_due_at <= now
  → for each enrollment, acquire a row-level lock before reading current stage:
       enrollment = JourneyEnrollment.objects.select_for_update().get(pk=enrollment.pk)
     Reason: concurrent webhook deliveries from the OTA or concurrent user actions (e.g. two
     Celery workers picking up the same tick) could double-advance an enrollment without this lock.
     select_for_update() serializes access to each enrollment row, ensuring only one worker
     advances the stage at a time. Wrap the per-enrollment block in transaction.atomic().
  → for each enrollment:
      step = enrollment.journey.steps.get(order=current_step_order)
      condition_result = condition_check(step, enrollment)

      if step.step_type == 'action':
          if condition_result:
              dispatch(step, enrollment)     ← email/SMS/WhatsApp/task
              JourneyStepLog.objects.create(skipped=False, ...)
          else:
              JourneyStepLog.objects.create(skipped=True, skip_reason='condition_false')
          advance enrollment to next step    ← ACTION always advances, pass or skip

      elif step.step_type == 'gate':
          if condition_result:
              # Gate opens — fire any content on this step, then advance
              dispatch(step, enrollment)     ← only if step has content (channel != None)
              JourneyStepLog.objects.create(gate_timed_out=False, ...)
              advance enrollment to next step
          else:
              gate_age = now() - enrollment.next_step_due_at
              if gate_age.days >= step.gate_timeout_days:
                  # Gate timed out — log and advance without firing content
                  JourneyStepLog.objects.create(gate_timed_out=True, skip_reason='gate_timeout')
                  advance enrollment to next step
              # else: condition still False and within timeout — DO NOT advance
              # The enrollment stays parked on this step; evaluate again next tick

      if no more steps:
          enrollment.status = 'completed'
```

**Critical distinction — ACTION vs GATE:**
An `ACTION` step (e.g. "Send 3-day follow-up email") evaluates its condition once. If False, the step is skipped and the enrollment advances. A `GATE` step (e.g. "Wait until Invoice Paid") parks the enrollment until the condition becomes True. A False evaluation on a GATE does **not** skip and advance — the system re-evaluates the same gate on every 15-minute tick until it opens or times out. This prevents the "Thank You for Paying" email being permanently lost because the 15-minute cron evaluated before payment arrived.

Condition check logic:

```python
def condition_check(step: JourneyStep, enrollment: JourneyEnrollment) -> bool:
    if step.condition_field == 'none':
        return True
    if step.condition_field == 'prev_opened':
        prev_log = enrollment.step_logs.filter(step__order=step.order - 1).last()
        return prev_log and prev_log.message_log and prev_log.message_log.read_at is not None
    if step.condition_field == 'document_signed':
        return enrollment.booking.envelopes.filter(status='signed').exists()
    if step.condition_field == 'invoice_paid':
        return enrollment.booking.invoices.filter(status='paid').exists()
    # … additional conditions
    return True
```

### 4.2 Trigger signal wiring

Each trigger event fires the enrollment signal from its source app:

| Trigger | Source signal |
|---|---|
| `booking_confirmed` | `reservations.signals.booking_confirmed` |
| `booking_checkout` | `reservations.signals.booking_checked_out` |
| `renewal_due` | Celery daily task scanning `Member.berth_contracts` for renewals due in 30 days |
| `insurance_expiring` | Celery daily task scanning `Member.insurance_status == 'due_soon'` |
| `invoice_overdue` | `billing.signals.invoice_paid` (inverted — fires if NOT paid by due date) |
| `document_unsigned` | Celery daily task scanning open `Envelope` records older than N days |

Enrollment deduplication: before creating a `JourneyEnrollment`, check for an existing active enrollment on the same `(journey, member, booking)` tuple to prevent double-enrollment if the trigger fires twice.

### 4.3 Frontend journey builder

Route: `/communications/journeys/{id}/builder`

Built with ReactFlow to provide a true visual, drag-and-drop DAG (Directed Acyclic Graph) editor. This allows non-linear journeys with branching conditions, which linear template pickers cannot support.

Three-zone layout:

**Left panel — Trigger selector.** Dropdown for trigger event. Preview text shows: "This journey starts when [trigger label]." Toggle for `is_active`.

**Center canvas — Step chain (ReactFlow).** Each step is a ReactFlow node connected by edges:
- Node header: `Step N — [channel icon] [channel label]`
- Node body: delay display (`+2 days`), condition display (if set)
- `+` button on node edges to insert a new step
- Drag nodes to reorder; step `order` is recomputed on save
- Click a node to open the step editor drawer

**Right drawer — Step editor.**
- **Step type toggle:** `[ Action ]` / `[ Gate — Wait Until ]` — prominently placed at the top of the drawer. When "Gate" is selected, the channel selector is hidden (gates have no outbound content by default; optional content can be added to fire when the gate opens), a "Timeout after" field appears (`[N] days`, default 7), and the condition selector is mandatory (condition_field cannot be `none` on a gate step).
- Channel selector (Email / SMS / WhatsApp / Staff Task) — hidden for Gate steps unless "fire content when gate opens" is toggled on
- Delay: `[number] [minutes|hours|days]` — for gates, this is the initial wait before the gate starts evaluating (e.g. "start checking after 1 day")
- Condition: `[field] [=|!=] [value]` — pre-built dropdown options, not a free-text expression; mandatory for Gate steps
- Content: subject + body editor (email), body only (SMS), template picker (WhatsApp), task title (task)
- WhatsApp step: template picker shows only `status=approved` templates
- Gate steps render in the ReactFlow canvas with a distinct "hourglass" icon and a yellow border to distinguish them visually from Action steps

### 4.4 Journey analytics

Route: `/communications/journeys/{id}/analytics`

Cards per step: Fired count / Skipped count / Opened / Clicked / Conversion rate (defined per journey as the final desired action, e.g. `booking_confirmed`, `invoice_paid`).

---

## 5. OTA Channel Manager Architecture

### 5.1 Adapter pattern

```python
# communications/ota/base.py

class OTAAdapter(ABC):
    def __init__(self, channel: OTAChannel):
        self.channel = channel

    @abstractmethod
    def push_availability(self, berths: list, date_from: date, date_to: date) -> dict:
        """Push availability calendar. Returns {'success': True, 'updated': N}."""

    @abstractmethod
    def pull_bookings(self, since: datetime) -> list[dict]:
        """Pull new reservations since last pull. Returns list of raw booking dicts."""

    @abstractmethod
    def cancel_booking(self, ota_ref: str) -> bool:
        """Cancel an OTA booking by OTA reference."""
```

Concrete adapters (build order: Dockwa → PitchUp → Snag-A-Slip → Rentals United):

```python
# communications/ota/adapters/dockwa.py
class DockwaAdapter(OTAAdapter): ...

# communications/ota/adapters/pitchup.py
class PitchUpAdapter(OTAAdapter): ...

# communications/ota/adapters/snag_a_slip.py
class SnagASlipAdapter(OTAAdapter): ...

# communications/ota/adapters/rentals_united.py
class RentalsUnitedAdapter(OTAAdapter): ...
```

Factory:

```python
# communications/ota/factory.py
ADAPTER_MAP = {
    'dockwa':         DockwaAdapter,
    'pitchup':        PitchUpAdapter,
    'snag_a_slip':    SnagASlipAdapter,
    'rentals_united': RentalsUnitedAdapter,
}

def get_adapter(channel: OTAChannel) -> OTAAdapter:
    cls = ADAPTER_MAP.get(channel.provider)
    if not cls:
        raise ValueError(f"No adapter for provider: {channel.provider}")
    return cls(channel)
```

### 5.2 Availability push

The push payload maps DocksBase berth availability to each OTA's iCal or proprietary API format. The common internal representation before serialization:

```python
@dataclass
class AvailabilitySlot:
    berth_id:    int
    berth_code:  str
    berth_category: str
    date:        date
    is_available: bool
    rate:        Decimal    # after pricing_delta_pct applied
    min_stay:    int = 1
    currency:    str = 'EUR'
```

Dockwa uses a REST API. PitchUp uses their partner REST API. Snag-A-Slip uses REST with iCal fallback. Rentals United uses XML/SOAP (`UpdateRates`, `UpdateAvailability`).

### 5.3 Booking import and conflict resolution

When `pull_bookings` returns new OTA reservations:

1. Check if `OTABooking(channel, ota_ref)` already exists. If yes, skip (idempotent).
2. Find or create a `Member` record matching the OTA guest email (match on email, create if none).
3. Find the target berth — OTA bookings specify berth category, not a specific berth. Run the existing availability algorithm (`reservations.services.find_available_berth`) to assign one.
4. If no berth available (conflict): create `OTABooking(booking=None)` + fire an `AlertRoute(alert_type='new_booking')` with a conflict flag. Manager resolves manually.
5. Create `Booking` with `source='ota_{provider}'` and link to `OTABooking`.
6. Record commission: `OTABooking.commission_pct` is configurable per channel; `commission_amount = booking.total * commission_pct / 100` is stored for reporting only and is never deducted from the booking invoice.

### 5.4 Webhook receivers (per OTA)

```
POST /api/v1/channels/webhook/dockwa/
POST /api/v1/channels/webhook/pitchup/
POST /api/v1/channels/webhook/snag-a-slip/
POST /api/v1/channels/webhook/rentals-united/
```

Each webhook view: authenticates the OTA's signature or shared secret, then calls the same booking-import service as the pull task. Webhooks are preferred; polling is the fallback for OTAs that do not support them.

### 5.5 Channel parity pricing

When pushing availability, the adapter applies `OTAChannel.pricing_delta_pct` to the base rate sourced from `ChargeableItem`. A markup of `+15%` means the OTA rate is `base_rate * 1.15`. Parity (`0%`) sends the direct rate unchanged. This keeps pricing logic in one place — the `ChargeableItem` is still the source of truth; the OTA layer applies a multiplicative delta.

### 5.6 Event-driven delta sync (real-time OTA inventory updates)

A 30-minute batch push (`push_ota_availability`) is not sufficient as the primary sync path. For a high-demand berth, the gap between a direct booking at 10:05 AM and the next batch push at 10:30 AM is a 25-minute double-booking window across every active OTA channel.

**Primary path — instant delta sync:**

A `post_save` signal is wired to the `Booking` model. When `Booking.status` transitions to `confirmed` or `cancelled`, the signal handler immediately dispatches a targeted Celery task:

```python
# reservations/signals.py

@receiver(post_save, sender=Booking)
def booking_status_changed(sender, instance, created, **kwargs):
    """
    Fire instant OTA delta sync when a booking is confirmed or cancelled.
    Only the affected berth × affected date range is pushed — not the full calendar.
    """
    if instance.status in ('confirmed', 'cancelled'):
        from channels.tasks import push_ota_availability_delta
        transaction.on_commit(lambda: push_ota_availability_delta.delay(
            berth_id=instance.berth_id,
            date_from=str(instance.arrival_date),
            date_to=str(instance.departure_date),
        ))
```

```python
# channels/tasks.py

@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def push_ota_availability_delta(self, berth_id: int, date_from: str, date_to: str):
    """
    Push a targeted availability update for a single berth × date range to all
    active OTA channels for the berth's marina.
    Called within seconds of a booking confirmation or cancellation.
    """
    berth = Berth.objects.select_related('marina').get(pk=berth_id)
    channels = OTAChannel.objects.filter(marina=berth.marina, is_active=True)
    for channel in channels:
        adapter = get_adapter(channel)
        try:
            adapter.push_availability(
                berths=[berth],
                date_from=date.fromisoformat(date_from),
                date_to=date.fromisoformat(date_to),
            )
            channel.last_push_at = now()
            channel.save(update_fields=['last_push_at'])
        except Exception as exc:
            raise self.retry(exc=exc)
```

**Secondary path — 30-minute self-healing batch:**

`push_ota_availability` (every 30 min) continues to run as a full 90-day calendar push. Its role is to correct any drift caused by missed signals, task queue backlog, or OTA-side cache issues. It is a safety net, not the primary sync mechanism.

The `OTAAdapter.push_availability` method signature accepts a `berths` list, enabling both targeted (delta, 1 berth) and full (batch, all berths) calls through the same interface without changes to the adapter implementations.

---

## 6. Booking Widget Architecture

The widget is a JavaScript bundle served by DocksBase and embedded on any external website via a single script tag. It uses Stripe Elements to keep the boater inside the iframe throughout the entire booking and payment flow.

### 6.1 Embed snippet

```html
<script
  src="https://widget.docksbase.com/v1/embed.js"
  data-marina="harbour-view-marina"
  data-primary-color="#1a3a5c"
  data-button-text="Reserve a Berth"
></script>
```

The snippet creates a `<div id="docksbase-widget">` in the page, then injects an `<iframe>` pointing to:

```
https://widget.docksbase.com/harbour-view-marina?
  mode=widget
  &origin=https%3A%2F%2Fwww.exampleymarina.com
  &primary-color=%231a3a5c
```

### 6.2 Widget frontend

A slim React bundle (separate Vite build target: `widget/`) that renders only the booking flow steps — no sidebar, no auth chrome. It communicates with the parent page via `window.postMessage`:

- `docksbase:booking_started` — user opened the calendar
- `docksbase:booking_confirmed` — booking created; parent page can trigger a thank-you overlay

The widget reads `BookingWidgetConfig` for the marina (colors, extras, allowed origins) from:

```
GET /public/widget-config/?marina=harbour-view-marina
```

No auth token is needed — this is a public endpoint. It returns the `BookingWidgetConfig` fields that are safe to expose publicly (colors, logo URL, allowed extras — not credentials).

### 6.3 CORS and origin allowlist

`BookingWidgetConfig.allowed_origins` is a JSON list of permitted parent domains (e.g. `["https://www.harbourview.ie"]`). The Django view for the widget config and all public portal endpoints check the `Origin` header against this list. Requests from unlisted origins get a `403`.

### 6.4 Iframe resize

The embed script listens for `postMessage({ type: 'docksbase:resize', height: N })` from the iframe and sets the iframe `height` attribute dynamically, eliminating the need for a fixed-height container on the marina's website.

### 6.5 Stateless cart — booking_token

**Why sessions cannot be used in the widget iframe:**

Safari ITP (Intelligent Tracking Prevention) and Chrome's third-party cookie policy block `widget.docksbase.com` from setting a session cookie when the widget is embedded inside `examplemarina.com`. If the existing `/public/` portal endpoints rely on a Django session cookie to track the boater's cart (dates, selected berth, add-ons) between wizard steps, the session will be silently dropped after the first step. The boater clicks "Next" and their cart vanishes.

**The fix — signed booking_token:**

The widget booking flow must be completely stateless. The cart state is serialized into a server-signed JWT (`booking_token`) and round-tripped through the client:

```
Step 1 — Boater selects dates + berth category:
  POST /public/widget/init-session/
  Body: { marina_slug, arrival_date, departure_date, berth_category, add_ons }
  → 200 { booking_token: "<signed JWT>", availability: [...] }
  (No session cookie set. The booking_token encodes the cart state + expiry.)

Step 2–4 — Every subsequent wizard API call:
  Authorization: Bearer <booking_token>
  The backend validates the JWT signature, extracts cart state, and processes
  the step without reading any server-side session.

Step 5 — Payment (Stripe Elements):
  The booking_token is passed alongside the Stripe PaymentIntent confirmation.
  On success, the backend creates the Booking + Invoice using state from the token.
```

The `booking_token` JWT payload:
```json
{
  "marina_id": 12,
  "arrival_date": "2026-07-04",
  "departure_date": "2026-07-07",
  "berth_category": "pontoon_6m",
  "add_ons": ["electricity"],
  "guest_email": "boater@example.com",
  "exp": 1780000000
}
```

Signing uses `settings.SECRET_KEY` (HMAC-SHA256). The token expires in 2 hours (configurable). The widget stores it in JavaScript memory for the session duration; if the boater refreshes the page, the wizard restarts (no cart recovery is needed — the flow takes under 5 minutes).

### 6.6 Payment in the widget — Stripe Elements

Payment is handled directly inside the widget iframe using `@stripe/react-stripe-js`. Credit card fields are rendered inside the iframe via Stripe Elements, keeping the boater on the marina's website throughout the entire transaction. This approach avoids the back-button breakage that full-page redirects to Stripe Hosted Checkout cause in an iframe context. After successful payment, the widget renders a confirmation screen and sends `docksbase:booking_confirmed` to the parent page.

### 6.7 Relation to the existing portal (Options 1, 2, 3)

The booking widget is a fourth delivery mode for the portal booking flow, complementing the three modes described in `project-overview.md` §3.3:

| Mode | URL | Auth chrome | Session mechanism |
|---|---|---|---|
| Option 1 — hosted path | `booking.docksbase.com/:slug` | Full portal | Django session cookie (same origin — no ITP issue) |
| Option 2 — redirect pre-fill | `booking.docksbase.com/:slug?arrival=…` | Full portal | Django session cookie (same origin) |
| Option 3 — custom domain | `booking.harbourview.com` | Full portal | Django session cookie (same origin) |
| **Widget** | Injected `<iframe>` on marina's own site | Stripped — booking flow only | **Stateless booking_token (JWT in-memory — no cookies)** |

Options 1–3 use the existing session-based flow unchanged. The widget uses the stateless `booking_token` flow exclusively. The backend `/public/widget/*` endpoints are a thin wrapper over the same booking service layer; the difference is how cart state is carried between requests.

---

## 7. API Contract

All authenticated endpoints require `Authorization: Bearer <JWT>` and are scoped to the user's marina.

### 7.1 Communications app

```
GET    /api/v1/communications/messages/
       ?channel=whatsapp|email|sms&direction=in|out&member={id}
       → list MessageLog (paginated, latest first)

GET    /api/v1/communications/messages/{id}/

GET    /api/v1/communications/whatsapp/templates/
POST   /api/v1/communications/whatsapp/templates/
GET    /api/v1/communications/whatsapp/templates/{id}/
PATCH  /api/v1/communications/whatsapp/templates/{id}/
POST   /api/v1/communications/whatsapp/templates/{id}/submit/
       → trigger Meta approval submission

POST   /api/v1/communications/whatsapp/webhook/   (public, Meta-signed)

GET    /api/v1/communications/alert-routes/
POST   /api/v1/communications/alert-routes/
PATCH  /api/v1/communications/alert-routes/{id}/
DELETE /api/v1/communications/alert-routes/{id}/   ← alert routes can be deleted (no financial history)

GET    /api/v1/communications/dotdigital/config/
PUT    /api/v1/communications/dotdigital/config/
POST   /api/v1/communications/dotdigital/sync/     ← trigger manual sync
GET    /api/v1/communications/dotdigital/segment-mappings/
POST   /api/v1/communications/dotdigital/segment-mappings/
DELETE /api/v1/communications/dotdigital/segment-mappings/{id}/
```

### 7.2 Journey builder

```
GET    /api/v1/communications/journeys/
POST   /api/v1/communications/journeys/
GET    /api/v1/communications/journeys/{id}/
PATCH  /api/v1/communications/journeys/{id}/
DELETE /api/v1/communications/journeys/{id}/   ← only if not active and no enrollments

GET    /api/v1/communications/journeys/{id}/steps/
POST   /api/v1/communications/journeys/{id}/steps/
PATCH  /api/v1/communications/journeys/{id}/steps/{step_id}/
DELETE /api/v1/communications/journeys/{id}/steps/{step_id}/

POST   /api/v1/communications/journeys/{id}/activate/
POST   /api/v1/communications/journeys/{id}/deactivate/

GET    /api/v1/communications/journeys/{id}/enrollments/
GET    /api/v1/communications/journeys/{id}/analytics/
       → {total_enrolled, completed, step_stats: [{step_id, fired, skipped, open_rate, click_rate}]}
```

### 7.3 Email campaigns

```
GET    /api/v1/communications/campaigns/
POST   /api/v1/communications/campaigns/
GET    /api/v1/communications/campaigns/{id}/
PATCH  /api/v1/communications/campaigns/{id}/
POST   /api/v1/communications/campaigns/{id}/send/         ← queue for send
POST   /api/v1/communications/campaigns/{id}/schedule/     ← set scheduled_at
GET    /api/v1/communications/campaigns/{id}/variants/
POST   /api/v1/communications/campaigns/{id}/variants/
PATCH  /api/v1/communications/campaigns/{id}/variants/{variant_id}/
GET    /api/v1/communications/campaigns/{id}/ab-test/
POST   /api/v1/communications/campaigns/{id}/ab-test/
```

### 7.4 Review requests

```
GET    /api/v1/communications/review-config/
PUT    /api/v1/communications/review-config/
GET    /api/v1/communications/review-requests/
       ?booking={id}&status=sent|opened|clicked
```

### 7.5 Coupon codes (billing app)

```
GET    /api/v1/billing/coupons/
POST   /api/v1/billing/coupons/
GET    /api/v1/billing/coupons/{id}/
PATCH  /api/v1/billing/coupons/{id}/
GET    /api/v1/billing/coupons/{id}/redemptions/
GET    /api/v1/billing/coupons/report/          ← usage + revenue impact per code

POST   /public/validate-coupon/
       body: { code: "SUMMER20", marina_slug: "harbour-view-marina", nights: 3 }
       → { valid: true, discount_type: "pct", discount_value: "20.00" }
          or { valid: false, reason: "Expired" | "MaxUsesReached" | "NotYetValid" }
       (public — no auth; rate-limited to 10 req/min per IP)

       ⚠ PRE-VALIDATION ONLY — this endpoint is for cart display feedback. It does NOT
       lock the coupon or guarantee availability. Under concurrent load, multiple users
       can pass this check simultaneously. Do NOT rely on this as the redemption gate.

       AUTHORITATIVE REDEMPTION — enforced at invoice finalization (inside the Stripe
       webhook handler / booking confirmation service):

         with transaction.atomic():
             coupon = CouponCode.objects.select_for_update().get(
                 marina__slug=marina_slug, code=code
             )
             if not coupon.is_active or coupon.uses_count >= coupon.max_uses:
                 # Over-limit: proceed at full price, alert the user
                 raise CouponExhausted("Coupon limit reached — booking processed at full price")
             coupon.uses_count = models.F('uses_count') + 1
             coupon.save(update_fields=['uses_count'])
             CouponRedemption.objects.create(coupon=coupon, booking=booking, discount_applied=amount)

       The pessimistic lock (select_for_update) serializes concurrent invoice finalizations
       against the same coupon row, preventing over-redemption regardless of how many users
       reach checkout simultaneously.
```

### 7.6 OTA channel manager

```
GET    /api/v1/channels/
POST   /api/v1/channels/
GET    /api/v1/channels/{id}/
PATCH  /api/v1/channels/{id}/
POST   /api/v1/channels/{id}/push-availability/   ← manual trigger
POST   /api/v1/channels/{id}/pull-bookings/       ← manual trigger
GET    /api/v1/channels/{id}/ota-bookings/

POST   /api/v1/channels/webhook/dockwa/      (public, OTA-signed)
POST   /api/v1/channels/webhook/pitchup/
POST   /api/v1/channels/webhook/snag-a-slip/
POST   /api/v1/channels/webhook/rentals-united/
```

### 7.7 Booking widget

```
GET    /public/widget-config/?marina=<slug>   (public, no auth)
       → { primary_color, button_text, logo_url, show_extras, allowed_origins }

GET    /public/widget-config/?domain=<custom_domain>  (same endpoint, domain-based lookup)

POST   /public/widget/init-session/    (public, no auth, rate-limited)
       body: { marina_slug, arrival_date, departure_date, berth_category, add_ons: [] }
       → 200 { booking_token: "<signed JWT>", availability: [...] }
       Sets NO session cookie. The booking_token encodes cart state (marina, dates,
       berth category, add-ons, guest_email, exp). Token is signed with HMAC-SHA256
       using settings.SECRET_KEY and expires in 2 hours.
       All subsequent widget booking steps send: Authorization: Bearer <booking_token>

GET    /public/widget/availability/    (Authorization: Bearer <booking_token>)
POST   /public/widget/booking-request/ (Authorization: Bearer <booking_token>)
POST   /public/widget/confirm-payment/ (Authorization: Bearer <booking_token>)
       ← finalizes booking after Stripe PaymentIntent succeeds; cart state sourced
          from the token, never from a server-side session
```

The widget's stateless endpoints are a thin wrapper over the same booking service layer used by Options 1–3. The only difference is the `booking_token` JWT carries the cart state rather than a Django session.

### 7.8 Lead conversion funnel report

```
GET    /api/v1/reports/lead-funnel/
       ?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&source=direct|ota_*
       → {
           widget_sessions: N,     ← from widget analytics (JS beacon)
           inquiries:        N,     ← BookingRequest records created
           quotes:           N,     ← BookingRequest converted to Booking (awaiting_payment)
           confirmed:        N,     ← Booking.status = confirmed
           paid:             N,     ← Invoice.status = paid
           drop_off_rates: { inquiry_to_quote: "42%", ... }
         }
```

### 7.9 Multi-site comparison report

```
GET    /api/v1/reports/multi-site/
       ?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
       Authorization: Bearer <JWT with MarinaGroupUserRole>
       → {
           group_name: "MGM Marinas",
           marinas: [
             { marina_id, name, occupancy_pct, adr, revenue, satisfaction_score },
             ...
           ]
         }
```

This endpoint requires the requesting user to have a `MarinaGroupUserRole` record. The response is scoped strictly to marinas within that user's `MarinaGroup`. Users without a group role receive a `403`. The platform admin grants group roles.

### 7.10 Marina group management

```
GET    /api/v1/accounts/marina-groups/
POST   /api/v1/accounts/marina-groups/
GET    /api/v1/accounts/marina-groups/{id}/
PATCH  /api/v1/accounts/marina-groups/{id}/
GET    /api/v1/accounts/marina-groups/{id}/memberships/
POST   /api/v1/accounts/marina-groups/{id}/memberships/
DELETE /api/v1/accounts/marina-groups/{id}/memberships/{marina_id}/
GET    /api/v1/accounts/marina-groups/{id}/user-roles/
POST   /api/v1/accounts/marina-groups/{id}/user-roles/
DELETE /api/v1/accounts/marina-groups/{id}/user-roles/{user_id}/
```

---

## 8. Frontend Architecture

### 8.1 New top-level screen: Communications

Route: `/communications`

Tab navigation (horizontal tabs within the screen):

| Tab | Sub-route | Content |
|---|---|---|
| Journeys | `/communications/journeys` | List of journeys with status badges; button to create |
| Campaigns | `/communications/campaigns` | Email campaign list; A/B test badge on applicable rows |
| WhatsApp | `/communications/whatsapp` | Template list + status badges; inbox (inbound thread list) |
| Alerts | `/communications/alerts` | `AlertRoute` configuration table (Slack/Teams) |
| Reviews | `/communications/reviews` | `ReviewConfig` settings + `ReviewRequest` log |
| Message Log | `/communications/log` | `MessageLog` filterable by channel/date/member |

### 8.2 New sub-screen: Journey Builder

Route: `/communications/journeys/{id}/builder`

ReactFlow canvas with drag-and-drop node editing. Each step node is a reusable `JourneyStepNode.jsx` component rendered inside the ReactFlow graph. The canvas supports non-linear branching, not just sequential chains.

Data hooks:
```js
useJourney(id)        // GET /journeys/{id}/ + /journeys/{id}/steps/
useJourneyMutations() // createStep, updateStep, deleteStep, reorderSteps, activate, deactivate
useWhatsAppTemplates() // for template picker in step editor
```

### 8.3 New sub-screen: Campaign Editor

Route: `/communications/campaigns/{id}/edit`

Two-column layout:
- Left: metadata (name, segment picker, schedule picker)
- Right: variant editor (tab A / tab B if A/B test enabled); rich text email body editor (use existing TipTap or a lightweight HTML textarea — match the pattern already used in the documents app)

A/B test toggle: when enabled, a second variant tab appears, the split percentage control appears (`[20]% each, [60]% held`), hold period selector, winner metric selector, winner action selector (defaults to Auto-Send).

### 8.4 New top-level screen: Channels (OTA)

Route: `/channels`

Listed in the sidebar under a new "Distribution" group alongside Booking Widget.

Layout: table of connected OTA channels. Each row shows provider logo (SVG icon), status (Active/Inactive), last push timestamp, last pull timestamp, booking count from this channel (month).

Action buttons: `Connect [OTA name]` (opens a credential drawer). `Push Now`. `Pull Now`.

Drawer: `OTAChannelDrawer.jsx` — form for API key/secret/property ID + pricing policy selector + pricing delta.

### 8.5 New top-level screen: Booking Widget

Route: `/widget`

Two-panel layout:
- Left: `BookingWidgetConfig` form (colors, button text, logo, extras toggles, allowed origins list)
- Right: live preview iframe showing the widget rendered with the current config

Code snippet panel at the bottom: pre-formatted `<script>` tag with the current marina slug and config, with a copy-to-clipboard button.

### 8.6 Reports extensions

Add two new tabs to the existing `Reports.jsx`:

- **Lead Funnel** tab: funnel chart (horizontal bar steps: Sessions → Inquiries → Quotes → Confirmed → Paid), filterable by source. Uses `useLeadFunnel()` hook.
- **Multi-Site** tab: visible only to users with a `MarinaGroupUserRole`. Table comparing marinas within the user's group. Uses `useMultiSiteReport()` hook.

### 8.7 Coupon Codes

Route: `/billing/coupons` — new tab in the existing Billing screen or a sub-page under the Billing nav item.

List/drawer pattern (same as Service Catalog). `CouponList.jsx` + `CouponFormDrawer.jsx`. Columns: Code, Type, Value, Valid dates, Uses (N / max), Status (Active/Expired/Maxed).

Report panel below list: table showing uses and revenue impact per code for the selected period.

---

## 9. Background Jobs

All Celery tasks use the existing `celery` + `redis` setup (or `celery` + `rabbitmq` — match whatever is already configured; the task definitions are broker-agnostic).

| Task name | Schedule | What it does |
|---|---|---|
| `evaluate_journey_steps` | Every 15 minutes | Evaluate all active `JourneyEnrollment` records due for their next step |
| `trigger_renewal_journeys` | Daily 09:00 | Find members with renewal due in 30 days; enroll in `RENEWAL_DUE` journeys |
| `trigger_insurance_journeys` | Daily 09:00 | Find members with `insurance_status='due_soon'`; enroll in `INSURANCE_EXPIRING` journeys |
| `trigger_unsigned_doc_journeys` | Daily 10:00 | Find open envelopes older than 3 days; enroll in `DOCUMENT_UNSIGNED` journeys |
| `send_review_requests` | Daily 11:00 | Find bookings checked out 24h ago (configurable) with no existing `ReviewRequest`; dispatch pre-screen email |
| `push_ota_availability` | Every 30 minutes | **Self-healing fallback only.** For all active `OTAChannel` records, call `adapter.push_availability(next_90_days)` to correct any drift. The primary sync path is `push_ota_availability_delta` (event-driven, see Section 5.6), which fires within seconds of any booking confirmation or cancellation. |
| `push_ota_availability_delta` | On-demand (signal-triggered) | Targeted delta: pushes a single berth × date range to all active OTAs. Dispatched via `transaction.on_commit()` from the `Booking.post_save` signal when status transitions to `confirmed` or `cancelled`. Retries 3× on failure. |
| `pull_ota_bookings` | Every 10 minutes | For OTAs without webhook support, call `adapter.pull_bookings(since=last_pull_at)` |
| `sync_dotdigital_segments` | Every 6 hours | For each `DotdigitalSegmentMapping`, evaluate the segment, compute the member list delta, push adds/removes via `MarketingAutomationAdapter` |
| `pull_dotdigital_campaign_results` | Daily 08:00 | Fetch open/click/unsubscribe data from Dotdigital for the last 7 days; update `MessageLog` records |
| `pick_ab_test_winner` | Every 30 minutes | Find `ABTest` records where hold period has elapsed; compare variant open/click rates; auto-send winner to remainder |
| `send_scheduled_campaigns` | Every 5 minutes | Find `EmailCampaign` records with `status=scheduled AND scheduled_at <= now`; trigger send |
| `send_slack_teams_alert` | On-demand (called inline, not scheduled) | Fire `AlertRoute` webhook for a given alert type; retries 3 times on failure |

### 9.1 Resend (email) webhook for open/click tracking

Resend sends webhook events to:

```
POST /api/v1/communications/email/webhook/
```

The view maps Resend event types to `MessageLog.status` updates:
- `email.delivered` → `status=delivered`
- `email.opened` → `status=read, read_at=event.timestamp`
- `email.clicked` → recorded as a separate `MessageLog` event with a note, or as a flag on the existing log
- `email.bounced` / `email.complained` → `status=failed, failed_reason=...`

This data feeds A/B test winner selection and journey step condition evaluation (`prev_opened`).

---

## 10. Implementation Steps

Steps are ordered to respect external dependency timelines (Meta WhatsApp approval, OTA credentials) and internal Django migration dependencies.

**Step 1 — Django app scaffolding (day 1)**
Create `backend/apps/communications/` and `backend/apps/channels/` apps. Register in `INSTALLED_APPS`. Create empty migrations. Add `communications` and `channels` to the root `urls.py`.

**Step 2 — Core models migration (day 1)**
Migrate `MessageLog`, `WhatsAppTemplate`, `AlertRoute`, `DotdigitalConfig`, `DotdigitalSegmentMapping`, `EmailCampaign`, `EmailCampaignVariant`, `ABTest`, `ReviewRequest`, `ReviewConfig`. Also migrate `CouponCode` + `CouponRedemption` into the `billing` app, `BookingWidgetConfig` into the `portal` app, `OTAChannel` + `OTABooking` into the `channels` app, and `MarinaGroup` + `MarinaGroupMembership` + `MarinaGroupUserRole` into the `accounts` app.

**Step 3 — Member model additions (day 1)**
Add `whatsapp_opt_in = BooleanField(default=False)` to `Member`. Remove any previously planned `group_access` boolean from `User` — multi-site access is now controlled via `MarinaGroupUserRole`.

**Step 4 — Apply for Meta WhatsApp Business API access (day 1, external)**
This is a multi-week process. Apply immediately. While approval is pending, all subsequent WhatsApp-related frontend and backend work can be built against the Meta sandbox environment.

**Step 5 — SMS provider selection (week 1)**
Select Twilio or Vonage. Replace the `notify_sms` stub in `fuel_dock/notifications.py` with a real dispatch function. Create `communications/adapters/sms.py` using the same interface as the WhatsApp adapter.

**Step 6 — Email dispatch via communications app (week 1)**
Route all outgoing transactional emails (currently scattered across `reservations/views.py`, `staff/views.py`, `billing/`) through `communications.services.dispatch(channel='email', ...)`. Every send creates a `MessageLog` record. Wire the Resend webhook receiver.

**Step 7 — Alert routes — Slack/Teams webhooks (week 1)**
Implement `send_slack_teams_alert` service. Wire it to existing Django signals: `booking_confirmed`, `payment_failed` (if signal exists), `defect_created`. Add `AlertRoute` CRUD API and frontend table.

**Step 8 — Coupon codes (week 2)**
Migrate `CouponCode` model into `billing`. Build API. Build `CouponFormDrawer.jsx`. Wire `/public/validate-coupon/` into the portal booking flow checkout step for UI feedback only. Implement the pessimistic `select_for_update()` lock in the booking confirmation / Stripe webhook handler for authoritative redemption enforcement. Integration test: simulate 30 concurrent requests against a coupon with `max_uses=10`; assert `CouponRedemption.objects.count()` is exactly 10 after all requests complete.

**Step 9 — Email campaign builder + A/B testing (week 2)**
Build `EmailCampaign` CRUD API and campaign editor screen. Implement `send_scheduled_campaigns` and `pick_ab_test_winner` Celery tasks (auto-send default). Wire Resend open/click webhooks to variant stat updates.

**Step 10 — Journey builder backend (week 3)**
Implement `Journey`, `JourneyStep`, `JourneyEnrollment`, `JourneyStepLog` models and API. Implement `evaluate_journey_steps` Celery task with full ACTION vs GATE branching logic (Section 4.1). Wire trigger signals. Unit-test `condition_check` for all condition types. Critical test case: configure a GATE step with `condition_field=invoice_paid`; run the evaluator while invoice is unpaid; assert the enrollment does NOT advance and no `JourneyStepLog` is created; pay the invoice; run the evaluator again; assert the gate opens, the step fires, and the enrollment advances.

**Step 11 — Journey builder frontend (week 3)**
Build ReactFlow canvas journey builder UI. Build `JourneyStepNode.jsx`. Build step editor drawer with channel, delay, condition, and content fields. The canvas supports drag-and-drop node reordering and branching.

**Step 12 — WhatsApp adapter (week 4, after Meta sandbox access)**
Implement `communications/adapters/whatsapp.py`. Implement webhook receiver with signature verification. Implement template submission flow. Wire approved templates into the journey step builder picker. Implement WhatsApp opt-in consent logging for both portal-initiated and staff-recorded consent paths. Full test against Meta sandbox.

**Step 13 — Marketing automation adapter + Dotdigital (week 4)**
Implement `communications/marketing/base.py` (`MarketingAutomationAdapter`). Implement `communications/marketing/dotdigital.py` as the first concrete implementation. Build `DotdigitalConfig` settings form. Implement `sync_dotdigital_segments` and `pull_dotdigital_campaign_results` Celery tasks. Build segment mapping UI.

**Step 14 — Review solicitation with pre-screen gating (week 4)**
Implement `send_review_requests` Celery task with pre-screen rating email. Route 4–5 star responses to public review platform URLs. Route 1–3 star responses to private DocksBase feedback form + fire `AlertRoute(alert_type='review_negative')`. Build `ReviewConfig` settings form. Build `ReviewRequest` log view.

**Step 15 — OTA adapter: Dockwa first (week 5)**
Dockwa has the highest US market demand. Implement `DockwaAdapter`. Wire the `push_ota_availability_delta` signal-triggered task (Section 5.6) to the `Booking.post_save` signal — this is the primary sync path. Wire the 30-minute `push_ota_availability` batch task as the self-healing fallback. Test against Dockwa sandbox: confirm that a test booking confirmation dispatches the delta task within seconds and that the Dockwa calendar updates before the next batch tick. Build channel config UI.

**Step 16 — OTA adapters: PitchUp, Snag-A-Slip, Rentals United (weeks 5–7, parallel)**
Implement remaining adapters in priority order. PitchUp is second (UK/EU crossover market). Snag-A-Slip is third. Rentals United uses XML/SOAP and is the most effort; build last.

**Step 17 — Booking widget with Stripe Elements (week 6)**
Create `widget/` Vite build target. Build slim React widget bundle with `@stripe/react-stripe-js` for embedded card fields. Implement `BookingWidgetConfig` model and API. Build widget config screen in the management frontend with live preview. Build `embed.js` snippet loader. Implement CORS origin validation.

Implement the stateless `booking_token` flow (Section 6.5): build `POST /public/widget/init-session/` returning a signed JWT; update the widget React app to store the token in memory and pass it as `Authorization: Bearer` on all subsequent calls; confirm zero session cookies are set. Test embed on an external HTML page in Safari with ITP enabled and in Chrome with third-party cookies disabled — assert the full booking wizard completes without cart loss across all four steps.

**Step 18 — Lead funnel + multi-site reports (week 7)**
Implement widget session beacon (`/public/widget-analytics/beacon/` — anonymous POST, rate-limited). Implement `lead-funnel` and `multi-site` report endpoints. The multi-site endpoint is scoped to the user's `MarinaGroup`. Add new tabs to `Reports.jsx`.

**Step 19 — Marina group management UI (week 7)**
Build marina group CRUD screens in the platform admin area. Build `MarinaGroupUserRole` assignment UI. Validate that multi-site report correctly scopes to group members only.

**Step 20 — WhatsApp go-live (week 8+, after Meta production approval)**
Switch `WHATSAPP_PROVIDER` env var from sandbox to production. Submit real templates for approval. Run end-to-end test with a real WhatsApp number. Activate Stripe Metered Billing for WhatsApp conversation overage on Enterprise accounts.

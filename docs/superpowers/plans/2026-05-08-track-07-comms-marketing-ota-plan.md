# Track 7 — Communications, Marketing & OTA: Implementation Plan
Date: 2026-05-08
Status: Ready for execution

---

## Overview

Track 7 introduces two new Django apps (`communications`, `channels`) plus targeted additions to existing apps (`billing`, `portal`, `accounts`). The feature scope is:

- **`communications` app** — unified message dispatch (email, SMS, WhatsApp, Slack, Teams), journey automation engine, email campaigns with A/B testing, review solicitation with pre-screen gating, Dotdigital marketing automation adapter.
- **`channels` app** — OTA channel manager (Dockwa first), real-time availability delta sync, OTA webhook receivers, booking widget stateless backend.
- **`billing` app additions** — `CouponCode` + `CouponRedemption` models, coupon CRUD API.
- **`portal` app additions** — `BookingWidgetConfig` model, public widget endpoints.
- **`accounts` app additions** — `MarinaGroup`, `MarinaGroupMembership`, `MarinaGroupUserRole` models.

No Celery is available yet. All deferred work uses `transaction.on_commit()` + synchronous functions. The `evaluate_journey_steps` Celery beat task and all other scheduled tasks are written as standard Celery tasks but will only run once Celery is wired in. Until then, provide a management command wrapper for each so they can be run manually.

All authenticated endpoints require `Authorization: Bearer <JWT>` and are scoped via `request.user.marina`.

---

## Part 1 — New Apps Scaffold

### 1.1 `apps/communications/` — AppConfig

**File: `backend/apps/communications/__init__.py`** — empty

**File: `backend/apps/communications/apps.py`**

```python
from django.apps import AppConfig


class CommunicationsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.communications'

    def ready(self):
        import apps.communications.signals  # noqa: F401
```

### 1.2 `apps/channels/` — AppConfig

**File: `backend/apps/channels/__init__.py`** — empty

**File: `backend/apps/channels/apps.py`**

```python
from django.apps import AppConfig


class ChannelsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.channels'

    def ready(self):
        import apps.channels.signals  # noqa: F401
```

---

## Part 2 — Models

### 2.1 `apps/communications/models.py`

Define all models in this single file, in dependency order.

#### `MessageLog`

```python
class MessageLog(models.Model):
    class Channel(models.TextChoices):
        EMAIL    = 'email',    'Email'
        SMS      = 'sms',     'SMS'
        WHATSAPP = 'whatsapp','WhatsApp'
        SLACK    = 'slack',   'Slack'
        TEAMS    = 'teams',   'Microsoft Teams'

    class Direction(models.TextChoices):
        OUTBOUND = 'out', 'Outbound'
        INBOUND  = 'in',  'Inbound'

    class Status(models.TextChoices):
        QUEUED    = 'queued',    'Queued'
        SENT      = 'sent',      'Sent'
        DELIVERED = 'delivered', 'Delivered'
        READ      = 'read',      'Read'
        FAILED    = 'failed',    'Failed'
        RECEIVED  = 'received',  'Received'

    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    member       = models.ForeignKey('members.Member', null=True, blank=True, on_delete=models.SET_NULL)
    booking      = models.ForeignKey('reservations.Booking', null=True, blank=True, on_delete=models.SET_NULL)
    journey_step = models.ForeignKey('JourneyStep', null=True, blank=True, on_delete=models.SET_NULL)

    channel    = models.CharField(max_length=20, choices=Channel.choices)
    direction  = models.CharField(max_length=3, choices=Direction.choices, default=Direction.OUTBOUND)
    status     = models.CharField(max_length=20, choices=Status.choices, default=Status.QUEUED)

    recipient  = models.CharField(max_length=500)
    subject    = models.CharField(max_length=500, blank=True)
    body       = models.TextField(blank=True)

    provider_message_id = models.CharField(max_length=200, blank=True)
    sent_at      = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    read_at      = models.DateTimeField(null=True, blank=True)
    failed_reason = models.TextField(blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['marina', 'channel', 'status']),
            models.Index(fields=['marina', 'member']),
        ]
```

#### `WhatsAppTemplate`

```python
class WhatsAppTemplate(models.Model):
    class Status(models.TextChoices):
        DRAFT    = 'draft',    'Draft'
        PENDING  = 'pending',  'Pending Meta Approval'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'

    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    name             = models.CharField(max_length=200)
    meta_name        = models.CharField(max_length=200, blank=True)
    language_code    = models.CharField(max_length=10, default='en')
    category         = models.CharField(max_length=50)
    body_text        = models.TextField()
    header_text      = models.CharField(max_length=500, blank=True)
    footer_text      = models.CharField(max_length=200, blank=True)
    status           = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    meta_template_id = models.CharField(max_length=200, blank=True)
    rejection_reason = models.TextField(blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)
    updated_at       = models.DateTimeField(auto_now=True)
```

#### `Journey`, `JourneyStep`, `JourneyEnrollment`, `JourneyStepLog`

```python
class Journey(models.Model):
    class TriggerEvent(models.TextChoices):
        BOOKING_CONFIRMED  = 'booking_confirmed',   'Booking Confirmed'
        BOOKING_CHECKOUT   = 'booking_checkout',    'Guest Checked Out'
        RENEWAL_DUE        = 'renewal_due',         'Annual Renewal Due'
        INSURANCE_EXPIRING = 'insurance_expiring',  'Insurance Expiring'
        INVOICE_OVERDUE    = 'invoice_overdue',     'Invoice Overdue'
        DOCUMENT_UNSIGNED  = 'document_unsigned',   'Document Unsigned'
        MANUAL             = 'manual',              'Manual Trigger'
        ACTIVITY_BOOKED    = 'activity_booked',     'Activity Booked'

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
        TASK     = 'task',    'Staff Task'

    class StepType(models.TextChoices):
        ACTION = 'action', 'Action — fire and advance'
        GATE   = 'gate',   'Gate — wait until condition is True'

    class ConditionField(models.TextChoices):
        PREVIOUS_STEP_OPENED  = 'prev_opened',    'Previous Step Opened'
        PREVIOUS_STEP_CLICKED = 'prev_clicked',   'Previous Step Clicked'
        BOOKING_STATUS        = 'booking_status', 'Booking Status'
        DOCUMENT_SIGNED       = 'document_signed','Document Signed'
        INVOICE_PAID          = 'invoice_paid',   'Invoice Paid'
        NONE                  = 'none',            'Always Fire'

    journey           = models.ForeignKey(Journey, on_delete=models.CASCADE, related_name='steps')
    order             = models.PositiveSmallIntegerField()
    step_type         = models.CharField(max_length=10, choices=StepType.choices, default=StepType.ACTION)
    gate_timeout_days = models.IntegerField(default=7)
    channel           = models.CharField(max_length=20, choices=Channel.choices)
    delay_unit        = models.CharField(max_length=10, choices=[('minutes','Minutes'),('hours','Hours'),('days','Days')])
    delay_value       = models.IntegerField(default=0)
    condition_field    = models.CharField(max_length=40, choices=ConditionField.choices, default=ConditionField.NONE)
    condition_operator = models.CharField(max_length=10, choices=[('eq','='),('neq','!=')], blank=True)
    condition_value    = models.CharField(max_length=200, blank=True)
    subject            = models.CharField(max_length=500, blank=True)
    body_template      = models.TextField(blank=True)
    whatsapp_template  = models.ForeignKey(WhatsAppTemplate, null=True, blank=True, on_delete=models.SET_NULL)
    task_title         = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ['journey', 'order']
        unique_together = [('journey', 'order')]


class JourneyEnrollment(models.Model):
    class Status(models.TextChoices):
        ACTIVE    = 'active',    'Active'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'
        FAILED    = 'failed',    'Failed'

    marina             = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    journey            = models.ForeignKey(Journey, on_delete=models.CASCADE, related_name='enrollments')
    member             = models.ForeignKey('members.Member', null=True, blank=True, on_delete=models.SET_NULL)
    booking            = models.ForeignKey('reservations.Booking', null=True, blank=True, on_delete=models.SET_NULL)
    status             = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    current_step_order = models.PositiveSmallIntegerField(default=1)
    enrolled_at        = models.DateTimeField(auto_now_add=True)
    next_step_due_at   = models.DateTimeField(null=True, blank=True)
    completed_at       = models.DateTimeField(null=True, blank=True)


class JourneyStepLog(models.Model):
    enrollment     = models.ForeignKey(JourneyEnrollment, on_delete=models.CASCADE, related_name='step_logs')
    step           = models.ForeignKey(JourneyStep, on_delete=models.CASCADE)
    message_log    = models.ForeignKey(MessageLog, null=True, blank=True, on_delete=models.SET_NULL)
    skipped        = models.BooleanField(default=False)
    skip_reason    = models.CharField(max_length=200, blank=True)
    gate_timed_out = models.BooleanField(default=False)
    fired_at       = models.DateTimeField(auto_now_add=True)
```

#### `AlertRoute`

```python
class AlertRoute(models.Model):
    class Platform(models.TextChoices):
        SLACK = 'slack', 'Slack'
        TEAMS = 'teams', 'Microsoft Teams'

    class AlertType(models.TextChoices):
        NEW_BOOKING     = 'new_booking',     'New Booking Received'
        PAYMENT_FAILURE = 'payment_failure', 'Payment Failure'
        CRITICAL_DEFECT = 'critical_defect', 'Critical Defect Logged'
        STOCK_LOW       = 'stock_low',       'Stock Below Minimum'
        OVERSTAY        = 'overstay',        'Overstay Detected'
        REVIEW_NEGATIVE = 'review_negative', 'Negative Review Received'
        INSTRUCTOR_CONFLICT = 'instructor_conflict', 'Activity Instructor Conflict'

    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    platform     = models.CharField(max_length=10, choices=Platform.choices)
    alert_type   = models.CharField(max_length=40, choices=AlertType.choices)
    webhook_url  = models.URLField()
    channel_name = models.CharField(max_length=200, blank=True)
    is_active    = models.BooleanField(default=True)
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'platform', 'alert_type')]
```

#### `DotdigitalConfig`, `DotdigitalSegmentMapping`

```python
class DotdigitalConfig(models.Model):
    marina          = models.OneToOneField('accounts.Marina', on_delete=models.CASCADE, related_name='dotdigital_config')
    api_username    = models.CharField(max_length=200)
    api_password    = models.CharField(max_length=200)  # store encrypted at rest — see settings note
    region          = models.CharField(max_length=10, default='r1')
    address_book_id = models.CharField(max_length=50, blank=True)
    last_sync_at    = models.DateTimeField(null=True, blank=True)
    sync_enabled    = models.BooleanField(default=False)


class DotdigitalSegmentMapping(models.Model):
    marina              = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    segment             = models.ForeignKey('members.Segment', on_delete=models.CASCADE)
    dotdigital_book_id  = models.CharField(max_length=50)
    last_sync_at        = models.DateTimeField(null=True, blank=True)
    last_sync_count     = models.IntegerField(default=0)
```

**Note on `members.Segment`:** This FK assumes a `Segment` model exists in `apps.members`. If it does not yet exist, replace with `members.Member` filtering logic and defer `DotdigitalSegmentMapping` until Track 5/6 segment work is merged.

#### `EmailCampaign`, `EmailCampaignVariant`, `ABTest`

```python
class EmailCampaign(models.Model):
    class Status(models.TextChoices):
        DRAFT     = 'draft',     'Draft'
        SCHEDULED = 'scheduled', 'Scheduled'
        SENDING   = 'sending',   'Sending'
        SENT      = 'sent',      'Sent'
        CANCELLED = 'cancelled', 'Cancelled'

    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    name         = models.CharField(max_length=200)
    segment      = models.ForeignKey('members.Segment', null=True, blank=True, on_delete=models.SET_NULL)
    status       = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    scheduled_at = models.DateTimeField(null=True, blank=True)
    sent_at      = models.DateTimeField(null=True, blank=True)
    total_sent   = models.IntegerField(default=0)
    created_at   = models.DateTimeField(auto_now_add=True)


class EmailCampaignVariant(models.Model):
    campaign    = models.ForeignKey(EmailCampaign, on_delete=models.CASCADE, related_name='variants')
    label       = models.CharField(max_length=1)       # 'A' or 'B'
    subject     = models.CharField(max_length=500)
    body_html   = models.TextField()
    split_pct   = models.IntegerField(default=100)
    sent_count  = models.IntegerField(default=0)
    open_count  = models.IntegerField(default=0)
    click_count = models.IntegerField(default=0)
    open_rate   = models.DecimalField(max_digits=5, decimal_places=2, default=0)


class ABTest(models.Model):
    class WinnerMetric(models.TextChoices):
        OPEN_RATE  = 'open_rate',  'Open Rate'
        CLICK_RATE = 'click_rate', 'Click Rate'

    class WinnerAction(models.TextChoices):
        AUTO_SEND = 'auto_send', 'Auto-send winner to remainder'
        ALERT     = 'alert',     'Alert manager — manual approval required'

    campaign       = models.OneToOneField(EmailCampaign, on_delete=models.CASCADE, related_name='ab_test')
    test_split_pct = models.IntegerField(default=20)
    hold_hours     = models.IntegerField(default=4)
    winner_metric  = models.CharField(max_length=20, choices=WinnerMetric.choices, default=WinnerMetric.OPEN_RATE)
    winner_action  = models.CharField(max_length=20, choices=WinnerAction.choices, default=WinnerAction.AUTO_SEND)
    winner_variant = models.ForeignKey(EmailCampaignVariant, null=True, blank=True, on_delete=models.SET_NULL, related_name='won_tests')
    winner_sent_at = models.DateTimeField(null=True, blank=True)
```

#### `ReviewRequest`, `ReviewConfig`

```python
class ReviewRequest(models.Model):
    class Platform(models.TextChoices):
        GOOGLE      = 'google',      'Google Business Profile'
        TRIPADVISOR = 'tripadvisor', 'TripAdvisor'
        DOCKWA      = 'dockwa',      'Dockwa'

    class Status(models.TextChoices):
        SENT      = 'sent',      'Sent'
        OPENED    = 'opened',    'Opened'
        CLICKED   = 'clicked',   'Clicked'
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
    marina                 = models.OneToOneField('accounts.Marina', on_delete=models.CASCADE, related_name='review_config')
    enabled                = models.BooleanField(default=False)
    delay_hours            = models.IntegerField(default=24)
    google_review_url      = models.URLField(blank=True)
    tripadvisor_review_url = models.URLField(blank=True)
    dockwa_review_url      = models.URLField(blank=True)
    send_channel           = models.CharField(max_length=20, choices=[('email','Email'),('sms','SMS')], default='email')
    negative_threshold     = models.IntegerField(default=3)
```

### 2.2 `apps/channels/models.py`

```python
from fernet_fields import EncryptedCharField  # pip install django-fernet-fields


class OTAChannel(models.Model):
    class Provider(models.TextChoices):
        RENTALS_UNITED = 'rentals_united', 'Rentals United'
        PITCHUP        = 'pitchup',        'PitchUp'
        SNAG_A_SLIP    = 'snag_a_slip',    'Snag-A-Slip'
        DOCKWA         = 'dockwa',         'Dockwa'
        MYSEA          = 'mysea',          'MySea'
        NOFOREIGNLAND  = 'noforeignland',  'Noforeignland'

    class PricingPolicy(models.TextChoices):
        PARITY   = 'parity',  'Rate Parity'
        MARKUP   = 'markup',  'Fixed Markup (%)'
        DISCOUNT = 'discount','Fixed Discount (%)'

    marina             = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    provider           = models.CharField(max_length=40, choices=Provider.choices)
    is_active          = models.BooleanField(default=False)
    api_key            = EncryptedCharField(max_length=255)
    api_secret         = EncryptedCharField(max_length=255)
    property_id        = models.CharField(max_length=200, blank=True)
    pricing_policy     = models.CharField(max_length=20, choices=PricingPolicy.choices, default=PricingPolicy.PARITY)
    pricing_delta_pct  = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    last_push_at       = models.DateTimeField(null=True, blank=True)
    last_pull_at       = models.DateTimeField(null=True, blank=True)
    created_at         = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'provider')]


class OTABooking(models.Model):
    channel           = models.ForeignKey(OTAChannel, on_delete=models.CASCADE, related_name='ota_bookings')
    booking           = models.OneToOneField('reservations.Booking', null=True, blank=True, on_delete=models.SET_NULL)
    ota_ref           = models.CharField(max_length=200)
    raw_payload       = models.JSONField(default=dict)
    commission_pct    = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    commission_amount = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    imported_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('channel', 'ota_ref')]
```

### 2.3 Additions to `apps/billing/models.py`

Append to the bottom of the existing `billing/models.py` file. Do not modify existing models.

```python
class CouponCode(models.Model):
    class DiscountType(models.TextChoices):
        PERCENTAGE = 'pct',   'Percentage'
        FIXED      = 'fixed', 'Fixed Amount'

    marina                = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    code                  = models.CharField(max_length=50)
    description           = models.CharField(max_length=300, blank=True)
    discount_type         = models.CharField(max_length=10, choices=DiscountType.choices)
    discount_value        = models.DecimalField(max_digits=8, decimal_places=2)
    applicable_categories = models.JSONField(default=list)
    minimum_stay_nights   = models.IntegerField(default=0)
    valid_from            = models.DateField()
    valid_until           = models.DateField()
    max_uses              = models.IntegerField(null=True, blank=True)
    uses_count            = models.IntegerField(default=0)
    is_active             = models.BooleanField(default=True)
    created_at            = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'code')]

    def is_valid(self):
        """Pre-validation only — NOT safe as the authoritative redemption gate. See docstring in spec."""
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
    coupon           = models.ForeignKey(CouponCode, on_delete=models.CASCADE, related_name='redemptions')
    booking          = models.ForeignKey('reservations.Booking', on_delete=models.CASCADE)
    discount_applied = models.DecimalField(max_digits=8, decimal_places=2)
    redeemed_at      = models.DateTimeField(auto_now_add=True)
```

### 2.4 Additions to `apps/portal/models.py`

Append to bottom of existing `portal/models.py`.

```python
class BookingWidgetConfig(models.Model):
    marina          = models.OneToOneField('accounts.Marina', on_delete=models.CASCADE, related_name='widget_config')
    is_enabled      = models.BooleanField(default=False)
    primary_color   = models.CharField(max_length=7, default='#1a3a5c')
    button_text     = models.CharField(max_length=100, default='Check Availability')
    logo_url        = models.URLField(blank=True)
    show_extras     = models.JSONField(default=list)
    allowed_origins = models.JSONField(default=list)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)
```

### 2.5 Additions to `apps/accounts/models.py`

Append to bottom of existing `accounts/models.py`. Also add `whatsapp_opt_in` to the existing `Member` model in `apps/members/models.py`.

```python
# accounts/models.py — append
class MarinaGroup(models.Model):
    name       = models.CharField(max_length=200)
    slug       = models.SlugField(unique=True)
    created_at = models.DateTimeField(auto_now_add=True)


class MarinaGroupMembership(models.Model):
    group  = models.ForeignKey(MarinaGroup, on_delete=models.CASCADE, related_name='memberships')
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='group_memberships')

    class Meta:
        unique_together = [('group', 'marina')]


class MarinaGroupUserRole(models.Model):
    class Role(models.TextChoices):
        VIEWER = 'viewer', 'Viewer'
        ADMIN  = 'admin',  'Admin'

    group = models.ForeignKey(MarinaGroup, on_delete=models.CASCADE, related_name='user_roles')
    user  = models.ForeignKey('accounts.User', on_delete=models.CASCADE, related_name='group_roles')
    role  = models.CharField(max_length=20, choices=Role.choices, default=Role.VIEWER)

    class Meta:
        unique_together = [('group', 'user')]
```

```python
# members/models.py — add field to Member model
whatsapp_opt_in = models.BooleanField(default=False)
```

---

## Part 3 — Service Layer

### 3.1 `apps/communications/services/dispatch.py`

Central dispatch function. All outbound message sends go through this function. It creates a `MessageLog` record, calls the appropriate adapter, and updates the log status.

```python
def dispatch(marina, channel, recipient, subject='', body='', member=None,
             booking=None, journey_step=None, whatsapp_template_name=None,
             whatsapp_variables=None) -> MessageLog:
    """
    Route a message to the correct channel adapter and log it.
    Never raises on adapter failure — logs status='failed' and returns the log.
    """
    log = MessageLog.objects.create(
        marina=marina, member=member, booking=booking, journey_step=journey_step,
        channel=channel, recipient=recipient, subject=subject, body=body,
        status=MessageLog.Status.QUEUED,
    )
    try:
        if channel == MessageLog.Channel.EMAIL:
            from .adapters.email import send_email
            provider_id = send_email(recipient, subject, body)
        elif channel == MessageLog.Channel.SMS:
            from .adapters.sms import send_sms
            provider_id = send_sms(recipient, body)
        elif channel == MessageLog.Channel.WHATSAPP:
            from .adapters.whatsapp import send_whatsapp_template
            if not member or not member.whatsapp_opt_in:
                raise ValueError('No WhatsApp opt-in')
            provider_id = send_whatsapp_template(recipient, whatsapp_template_name, whatsapp_variables)
        elif channel in (MessageLog.Channel.SLACK, MessageLog.Channel.TEAMS):
            from .adapters.slack_teams import send_webhook
            send_webhook(recipient, body)
            provider_id = ''
        else:
            raise ValueError(f'Unknown channel: {channel}')
        log.status = MessageLog.Status.SENT
        log.provider_message_id = provider_id or ''
        log.sent_at = timezone.now()
    except Exception as e:
        log.status = MessageLog.Status.FAILED
        log.failed_reason = str(e)
    log.save(update_fields=['status', 'provider_message_id', 'sent_at', 'failed_reason'])
    return log
```

### 3.2 `apps/communications/services/alert.py`

```python
def send_alert(marina_id, alert_type, subject, body, priority='normal'):
    """
    Fire all active AlertRoute webhooks for the given alert_type and marina.
    Called by signals and service layers across apps. Non-blocking — failures are logged, not raised.
    """
    from apps.communications.models import AlertRoute
    routes = AlertRoute.objects.filter(marina_id=marina_id, alert_type=alert_type, is_active=True)
    for route in routes:
        try:
            from apps.communications.services.dispatch import dispatch
            dispatch(
                marina_id=marina_id,
                channel=route.platform,  # 'slack' or 'teams'
                recipient=route.webhook_url,
                body=body,
                subject=subject,
            )
        except Exception:
            pass  # failures are already logged inside dispatch()
```

### 3.3 `apps/communications/services/journey.py`

**`enroll_in_journey(journey_id, marina, member=None, booking=None)`**

- Guard: if `JourneyEnrollment` already exists with `status='active'` for `(journey, member, booking)`, skip (deduplication).
- Get first step. Compute `next_step_due_at = now() + step.delay as timedelta`.
- Create `JourneyEnrollment(status='active', current_step_order=1, next_step_due_at=...)`.

**`condition_check(step, enrollment) -> bool`**

```python
def condition_check(step, enrollment):
    if step.condition_field == 'none':
        return True
    if step.condition_field == 'prev_opened':
        prev_log = enrollment.step_logs.filter(step__order=step.order - 1).last()
        return bool(prev_log and prev_log.message_log and prev_log.message_log.read_at)
    if step.condition_field == 'document_signed':
        return enrollment.booking and enrollment.booking.waiver_signed
    if step.condition_field == 'invoice_paid':
        return (enrollment.booking and
                enrollment.booking.invoices.filter(status='paid').exists())
    if step.condition_field == 'booking_status':
        return (enrollment.booking and
                enrollment.booking.status == step.condition_value)
    return True
```

**`advance_enrollment(enrollment_id)`**

Must be called inside `transaction.atomic()` with `select_for_update()`. Full ACTION vs GATE logic as specified in spec §4.1. Steps:

1. `enrollment = JourneyEnrollment.objects.select_for_update().get(pk=enrollment_id)` inside `transaction.atomic()`.
2. Fetch current step.
3. Evaluate `condition_check()`.
4. ACTION: dispatch if condition True (skip if False); always advance; write `JourneyStepLog`.
5. GATE: if condition True → dispatch (if step has content), write log, advance. If condition False → check gate age against `gate_timeout_days`. If timed out → write log (`gate_timed_out=True`), advance. Otherwise → do nothing (stay parked).
6. Advance = find next step; if none, set `enrollment.status='completed'`, `completed_at=now()`.

**`evaluate_all_due_enrollments()`**

Called by the Celery task or management command. Fetches all `JourneyEnrollment` with `status='active'` and `next_step_due_at <= now()`. Calls `advance_enrollment(pk)` for each. Wrap each in a try/except to prevent one bad enrollment from aborting others.

### 3.4 `apps/communications/services/campaigns.py`

**`send_campaign_batch(campaign_id, chunk_size=200)`**

```python
def send_campaign_batch(campaign_id, chunk_size=200):
    with transaction.atomic():
        campaign = EmailCampaign.objects.select_for_update().get(pk=campaign_id)
        if campaign.status != EmailCampaign.Status.SCHEDULED:
            return
        campaign.status = EmailCampaign.Status.SENDING
        campaign.save(update_fields=['status'])

    # Resolve audience — members in segment (or all marina members if no segment)
    if campaign.segment_id:
        members = campaign.segment.members.filter(marina=campaign.marina)
    else:
        from apps.members.models import Member
        members = Member.objects.filter(marina=campaign.marina)

    # Determine variant distribution (A/B or single)
    variant_a = campaign.variants.filter(label='A').first()
    # Send in chunks to avoid OOM on large member lists
    for i in range(0, members.count(), chunk_size):
        batch = members[i:i+chunk_size]
        for member in batch:
            variant = variant_a  # A/B selection handled separately by pick_ab_test_winner
            dispatch(marina=campaign.marina, channel='email',
                     recipient=member.email, subject=variant.subject, body=variant.body_html,
                     member=member)
            EmailCampaignVariant.objects.filter(pk=variant.pk).update(sent_count=F('sent_count') + 1)

    campaign.status = EmailCampaign.Status.SENT
    campaign.sent_at = timezone.now()
    campaign.save(update_fields=['status', 'sent_at'])
```

**`pick_ab_test_winner(ab_test_id)`** — compare `open_rate` on each variant; send winning variant to remainder audience; set `ABTest.winner_variant` and `winner_sent_at`.

### 3.5 `apps/channels/services/ota.py`

**`handle_ota_webhook(channel, payload)`**

```python
def handle_ota_webhook(channel, payload):
    from apps.channels.ota.factory import get_adapter
    adapter = get_adapter(channel)
    bookings = adapter.parse_webhook_payload(payload)
    for raw_booking in bookings:
        import_ota_booking(channel, raw_booking)


def import_ota_booking(channel, raw_booking):
    ota_ref = raw_booking['ota_ref']
    # Idempotency guard
    ota_booking, created = OTABooking.objects.get_or_create(
        channel=channel,
        ota_ref=ota_ref,
        defaults={'raw_payload': raw_booking},
    )
    if not created:
        return  # already imported — OTA webhook retry, skip

    # Find or create member
    from apps.members.models import Member
    member, _ = Member.objects.get_or_create(
        marina=channel.marina,
        email=raw_booking.get('guest_email', ''),
        defaults={'name': raw_booking.get('guest_name', ''), 'marina': channel.marina},
    )

    # Find available berth
    from apps.reservations.booking_engine import compatible_available_berths
    try:
        berth = compatible_available_berths(
            marina=channel.marina,
            arrival=raw_booking['arrival_date'],
            departure=raw_booking['departure_date'],
        ).first()
    except Exception:
        berth = None

    if not berth:
        # Conflict — create OTABooking without internal Booking; fire alert
        from apps.communications.services.alert import send_alert
        send_alert(channel.marina_id, 'new_booking', 'OTA Booking Conflict',
                   f'No berth available for OTA ref {ota_ref}')
        return

    from apps.reservations.models import Booking
    booking = Booking.objects.create(
        marina=channel.marina,
        berth=berth,
        check_in=raw_booking['arrival_date'],
        check_out=raw_booking['departure_date'],
        guest_name=raw_booking.get('guest_name', ''),
        guest_email=raw_booking.get('guest_email', ''),
        booking_source=f'ota_{channel.provider}',
        status='confirmed',
    )
    ota_booking.booking = booking
    ota_booking.commission_pct = channel.commission_pct if hasattr(channel, 'commission_pct') else 0
    ota_booking.commission_amount = (booking.amount or 0) * ota_booking.commission_pct / 100
    ota_booking.save(update_fields=['booking', 'commission_pct', 'commission_amount'])
```

### 3.6 `apps/channels/ota/` — Adapter pattern

**`apps/channels/ota/base.py`**

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal
from datetime import date

@dataclass
class AvailabilitySlot:
    berth_id:       int
    berth_code:     str
    berth_category: str
    date:           date
    is_available:   bool
    rate:           Decimal
    min_stay:       int = 1
    currency:       str = 'EUR'


class OTAAdapter(ABC):
    def __init__(self, channel):
        self.channel = channel

    @abstractmethod
    def push_availability(self, berths, date_from, date_to) -> dict: ...

    @abstractmethod
    def pull_bookings(self, since) -> list: ...

    @abstractmethod
    def cancel_booking(self, ota_ref) -> bool: ...

    def parse_webhook_payload(self, payload) -> list:
        """Override in adapters that support webhooks. Default: return empty list."""
        return []
```

**`apps/channels/ota/adapters/dockwa.py`** — implement `DockwaAdapter(OTAAdapter)` against the Dockwa REST API. Build first. Leave `push_availability`, `pull_bookings`, `cancel_booking` as stubbed `raise NotImplementedError` initially; implement one at a time against Dockwa sandbox.

**`apps/channels/ota/factory.py`**

```python
from apps.channels.ota.adapters.dockwa import DockwaAdapter

ADAPTER_MAP = {
    'dockwa': DockwaAdapter,
    # 'pitchup':        PitchUpAdapter,   # add as built
    # 'snag_a_slip':    SnagASlipAdapter,
    # 'rentals_united': RentalsUnitedAdapter,
}

def get_adapter(channel):
    cls = ADAPTER_MAP.get(channel.provider)
    if not cls:
        raise ValueError(f'No adapter for provider: {channel.provider}')
    return cls(channel)
```

---

## Part 4 — Celery Tasks (and management command wrappers)

All tasks live in `apps/communications/tasks.py` and `apps/channels/tasks.py`. Each task also has a management command wrapper so it can be triggered manually before Celery is wired.

### 4.1 `apps/communications/tasks.py`

```python
from celery import shared_task

@shared_task
def evaluate_journey_steps():
    from apps.communications.services.journey import evaluate_all_due_enrollments
    evaluate_all_due_enrollments()

@shared_task
def send_scheduled_campaigns():
    from django.utils import timezone
    from apps.communications.models import EmailCampaign
    from apps.communications.services.campaigns import send_campaign_batch
    due = EmailCampaign.objects.filter(status='scheduled', scheduled_at__lte=timezone.now())
    for campaign in due:
        send_campaign_batch(campaign.pk)

@shared_task
def pick_ab_test_winner():
    from apps.communications.services.campaigns import pick_ab_test_winner as _pick
    from apps.communications.models import ABTest
    from django.utils import timezone
    from datetime import timedelta
    for test in ABTest.objects.filter(winner_variant__isnull=True):
        hold_end = test.campaign.sent_at + timedelta(hours=test.hold_hours) if test.campaign.sent_at else None
        if hold_end and timezone.now() >= hold_end:
            _pick(test.pk)

@shared_task
def send_review_requests():
    from apps.communications.services.reviews import dispatch_pending_review_requests
    dispatch_pending_review_requests()

@shared_task
def trigger_renewal_journeys():
    from apps.communications.services.journey_triggers import trigger_renewal_journeys as _t
    _t()

@shared_task
def trigger_insurance_journeys():
    from apps.communications.services.journey_triggers import trigger_insurance_journeys as _t
    _t()

@shared_task
def trigger_unsigned_doc_journeys():
    from apps.communications.services.journey_triggers import trigger_unsigned_doc_journeys as _t
    _t()

@shared_task
def sync_dotdigital_segments():
    from apps.communications.services.dotdigital import sync_all_segments
    sync_all_segments()
```

### 4.2 `apps/channels/tasks.py`

```python
from celery import shared_task

@shared_task
def push_ota_availability():
    """Self-healing 30-minute batch fallback. Pushes full 90-day calendar for all active channels."""
    from apps.channels.models import OTAChannel
    from apps.channels.ota.factory import get_adapter
    from datetime import date, timedelta
    date_from = date.today()
    date_to   = date_from + timedelta(days=90)
    for channel in OTAChannel.objects.filter(is_active=True).select_related('marina'):
        berths = list(channel.marina.berths.all())
        adapter = get_adapter(channel)
        try:
            adapter.push_availability(berths=berths, date_from=date_from, date_to=date_to)
            channel.last_push_at = timezone.now()
            channel.save(update_fields=['last_push_at'])
        except Exception:
            pass  # logged by adapter; do not abort other channels

@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def push_ota_availability_delta(self, berth_id, date_from, date_to):
    """
    Real-time delta sync. Triggered by Booking.post_save signal via transaction.on_commit().
    Only pushes the affected berth × date range to all active OTAs for that marina.
    """
    from apps.berths.models import Berth
    from apps.channels.models import OTAChannel
    from apps.channels.ota.factory import get_adapter
    from datetime import date as _date
    from django.utils import timezone
    berth = Berth.objects.select_related('marina').get(pk=berth_id)
    channels = OTAChannel.objects.filter(marina=berth.marina, is_active=True)
    for channel in channels:
        adapter = get_adapter(channel)
        try:
            adapter.push_availability(
                berths=[berth],
                date_from=_date.fromisoformat(date_from),
                date_to=_date.fromisoformat(date_to),
            )
            channel.last_push_at = timezone.now()
            channel.save(update_fields=['last_push_at'])
        except Exception as exc:
            raise self.retry(exc=exc)

@shared_task
def pull_ota_bookings():
    """Polling fallback for OTAs without webhook support."""
    from apps.channels.models import OTAChannel
    from apps.channels.ota.factory import get_adapter
    from apps.channels.services.ota import import_ota_booking
    from django.utils import timezone
    for channel in OTAChannel.objects.filter(is_active=True).select_related('marina'):
        adapter = get_adapter(channel)
        since = channel.last_pull_at or timezone.now()
        try:
            raw_bookings = adapter.pull_bookings(since=since)
            for raw in raw_bookings:
                import_ota_booking(channel, raw)
            channel.last_pull_at = timezone.now()
            channel.save(update_fields=['last_pull_at'])
        except Exception:
            pass
```

---

## Part 5 — Signals

### 5.1 `apps/communications/signals.py`

```python
from django.dispatch import Signal

# Fired when a WhatsApp inbound message arrives
whatsapp_message_received = Signal()  # provides: marina, member, message_log
```

### 5.2 `apps/reservations/receivers.py` — additions

Add the OTA delta sync trigger to the existing `receivers.py`. Add after the existing `on_booking_save` receiver:

```python
@receiver(post_save, sender=Booking, dispatch_uid='reservations.ota_delta_sync')
def booking_status_changed_ota_sync(sender, instance, created, **kwargs):
    """
    Fire instant OTA delta sync when a booking is confirmed or cancelled.
    Uses transaction.on_commit() to ensure the booking row is committed before the task runs.
    """
    if instance.status not in ('confirmed', 'cancelled'):
        return
    if not instance.berth_id:
        return
    from django.db import transaction
    transaction.on_commit(lambda: _dispatch_ota_delta(instance))


def _dispatch_ota_delta(instance):
    try:
        from apps.channels.tasks import push_ota_availability_delta
        push_ota_availability_delta.delay(
            berth_id=instance.berth_id,
            date_from=str(instance.check_in),
            date_to=str(instance.check_out),
        )
    except Exception:
        pass  # Celery not yet wired — silent skip; batch fallback will correct drift
```

---

## Part 6 — API Endpoints

### 6.1 `apps/communications/views.py` + `apps/communications/urls.py`

Use DRF `ModelViewSet` and `APIView` patterns consistent with existing codebase. All authenticated views inherit from `IsAuthenticated` and scope queryset with `request.user.marina`.

**`apps/communications/urls.py`**

```python
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    MessageLogViewSet, WhatsAppTemplateViewSet, AlertRouteViewSet,
    JourneyViewSet, JourneyStepViewSet, EmailCampaignViewSet,
    ReviewRequestListView, ReviewConfigView,
    DotdigitalConfigView, DotdigitalSyncView, DotdigitalSegmentMappingViewSet,
    WhatsAppWebhookView, EmailWebhookView,
)

router = DefaultRouter()
router.register('messages',                 MessageLogViewSet,              basename='message-log')
router.register('whatsapp/templates',       WhatsAppTemplateViewSet,        basename='whatsapp-template')
router.register('alert-routes',             AlertRouteViewSet,              basename='alert-route')
router.register('journeys',                 JourneyViewSet,                 basename='journey')
router.register('campaigns',                EmailCampaignViewSet,           basename='campaign')
router.register('dotdigital/segment-mappings', DotdigitalSegmentMappingViewSet, basename='dotdigital-mapping')

urlpatterns = [
    path('', include(router.urls)),
    path('journeys/<int:journey_pk>/steps/', JourneyStepViewSet.as_view({'get': 'list', 'post': 'create'})),
    path('journeys/<int:journey_pk>/steps/<int:pk>/', JourneyStepViewSet.as_view({'patch': 'partial_update', 'delete': 'destroy'})),
    path('review-config/',                  ReviewConfigView.as_view(),         name='review-config'),
    path('review-requests/',                ReviewRequestListView.as_view(),     name='review-requests'),
    path('dotdigital/config/',              DotdigitalConfigView.as_view(),      name='dotdigital-config'),
    path('dotdigital/sync/',                DotdigitalSyncView.as_view(),        name='dotdigital-sync'),
    path('whatsapp/webhook/',               WhatsAppWebhookView.as_view(),       name='whatsapp-webhook'),
    path('email/webhook/',                  EmailWebhookView.as_view(),          name='email-webhook'),
]
```

**Key ViewSet notes:**

- `JourneyViewSet` — add `@action(detail=True, methods=['post'])` for `activate` and `deactivate` actions. Add `@action(detail=True, methods=['get'])` for `enrollments` and `analytics`.
- `EmailCampaignViewSet` — add `@action` for `send`, `schedule`. Nested `variants/` and `ab-test/` can be separate ViewSets registered under `campaigns/<pk>/variants/`.
- `WhatsAppTemplateViewSet` — add `@action(detail=True, methods=['post'])` for `submit` (triggers Meta approval submission).
- `WhatsAppWebhookView` — **public, not JWT authenticated**. Verify `X-Hub-Signature-256` header using `WHATSAPP_VERIFY_TOKEN` from settings. Use `AllowAny` permission class.
- `EmailWebhookView` — **public**. Verify Resend webhook signature. Maps `email.delivered`, `email.opened`, `email.clicked`, `email.bounced` to `MessageLog.status` updates.

### 6.2 `apps/channels/views.py` + `apps/channels/urls.py`

```python
# apps/channels/urls.py
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import OTAChannelViewSet, OTABookingWebhookView

router = DefaultRouter()
router.register('', OTAChannelViewSet, basename='ota-channel')

urlpatterns = [
    path('', include(router.urls)),
    path('webhook/dockwa/',         OTABookingWebhookView.as_view({'post': 'dockwa'}),         name='webhook-dockwa'),
    path('webhook/pitchup/',        OTABookingWebhookView.as_view({'post': 'pitchup'}),        name='webhook-pitchup'),
    path('webhook/snag-a-slip/',    OTABookingWebhookView.as_view({'post': 'snag_a_slip'}),    name='webhook-snagaslip'),
    path('webhook/rentals-united/', OTABookingWebhookView.as_view({'post': 'rentals_united'}), name='webhook-rentalsunited'),
]
```

`OTAChannelViewSet` — standard CRUD plus `@action` for `push_availability` (POST, calls task directly or via `on_commit`) and `pull_bookings` (POST). Add nested `ota-bookings/` action.

`OTABookingWebhookView` — **public, not JWT authenticated**. Each action verifies the OTA-specific signature/token from `settings.OTA_WEBHOOK_TOKENS[provider]`. On success, calls `handle_ota_webhook(channel, payload)`.

### 6.3 Billing coupon endpoints — add to `apps/billing/urls.py`

Add these paths to the existing `billing/urls.py` urlpatterns:

```python
path('coupons/',                     CouponListCreateView.as_view(),       name='coupon_list'),
path('coupons/<int:pk>/',            CouponDetailView.as_view(),           name='coupon_detail'),
path('coupons/<int:pk>/redemptions/',CouponRedemptionListView.as_view(),   name='coupon_redemptions'),
path('coupons/report/',              CouponReportView.as_view(),           name='coupon_report'),
```

Also add to `config/urls.py` under the `public/` prefix:

```python
path('validate-coupon/', ValidateCouponView.as_view(), name='validate_coupon'),
```

`ValidateCouponView` — `AllowAny`, rate-limit to 10 req/min per IP (use `django-ratelimit` or a simple counter). Calls `coupon.is_valid()` — pre-validation only. Returns `{ valid, discount_type, discount_value }` or `{ valid: false, reason }`. Does NOT lock the coupon.

### 6.4 Portal widget endpoints — add to `apps/portal/public_urls.py`

```python
path('widget-config/',          WidgetConfigView.as_view(),        name='widget_config'),
path('widget/init-session/',    WidgetInitSessionView.as_view(),   name='widget_init_session'),
path('widget/availability/',    WidgetAvailabilityView.as_view(),  name='widget_availability'),
path('widget/booking-request/', WidgetBookingRequestView.as_view(),name='widget_booking_request'),
path('widget/confirm-payment/', WidgetConfirmPaymentView.as_view(),name='widget_confirm_payment'),
```

`WidgetInitSessionView` — AllowAny, rate-limited. Validates `Origin` header against `BookingWidgetConfig.allowed_origins`. Signs a `booking_token` JWT using `settings.SECRET_KEY` with HMAC-SHA256, 2-hour expiry. Returns `{ booking_token, availability }`. Sets **no** session cookie.

All subsequent widget views authenticate via `Authorization: Bearer <booking_token>` — write a custom DRF authentication class `BookingTokenAuthentication` that validates the JWT signature and extracts cart state.

### 6.5 Accounts group endpoints — add to `apps/accounts/`

Create `apps/accounts/group_urls.py`:

```python
path('marina-groups/',                              MarinaGroupListCreateView.as_view()),
path('marina-groups/<int:pk>/',                     MarinaGroupDetailView.as_view()),
path('marina-groups/<int:pk>/memberships/',         MarinaGroupMembershipView.as_view()),
path('marina-groups/<int:pk>/memberships/<int:marina_id>/', MarinaGroupMembershipDeleteView.as_view()),
path('marina-groups/<int:pk>/user-roles/',          MarinaGroupUserRoleView.as_view()),
path('marina-groups/<int:pk>/user-roles/<int:user_id>/', MarinaGroupUserRoleDeleteView.as_view()),
```

Include in `config/urls.py` under `api/v1/accounts/`.

### 6.6 Reports extensions — add to `apps/reports/`

Add to `apps/reports/urls.py`:

```python
path('lead-funnel/',  LeadFunnelReportView.as_view(),  name='lead_funnel'),
path('multi-site/',   MultiSiteReportView.as_view(),   name='multi_site'),
```

`MultiSiteReportView` — check `request.user.group_roles.exists()`. If not, return 403. Scope response to marinas in the user's group.

---

## Part 7 — Admin

### `apps/communications/admin.py`

```python
from django.contrib import admin
from .models import (
    MessageLog, WhatsAppTemplate, Journey, JourneyStep, JourneyEnrollment,
    JourneyStepLog, AlertRoute, DotdigitalConfig, EmailCampaign,
    EmailCampaignVariant, ABTest, ReviewRequest, ReviewConfig,
)

@admin.register(MessageLog)
class MessageLogAdmin(admin.ModelAdmin):
    list_display = ['marina', 'channel', 'direction', 'status', 'recipient', 'created_at']
    list_filter  = ['channel', 'direction', 'status']
    search_fields = ['recipient', 'subject']
    readonly_fields = ['marina', 'member', 'booking', 'channel', 'recipient', 'body',
                       'provider_message_id', 'sent_at', 'delivered_at', 'read_at',
                       'failed_reason', 'created_at']

@admin.register(Journey)
class JourneyAdmin(admin.ModelAdmin):
    list_display = ['name', 'marina', 'trigger', 'is_active']
    list_filter  = ['trigger', 'is_active']

admin.register(WhatsAppTemplate, JourneyEnrollment, AlertRoute, EmailCampaign,
               ReviewRequest, ReviewConfig, DotdigitalConfig)
```

### `apps/channels/admin.py`

```python
from django.contrib import admin
from .models import OTAChannel, OTABooking

@admin.register(OTAChannel)
class OTAChannelAdmin(admin.ModelAdmin):
    list_display = ['marina', 'provider', 'is_active', 'last_push_at', 'last_pull_at']
    list_filter  = ['provider', 'is_active']
    # api_key and api_secret are EncryptedCharField — do not display in admin

@admin.register(OTABooking)
class OTABookingAdmin(admin.ModelAdmin):
    list_display = ['channel', 'ota_ref', 'booking', 'commission_amount', 'imported_at']
    readonly_fields = ['raw_payload']
```

---

## Part 8 — Settings & URL Wiring

### 8.1 `config/settings/base.py` — LOCAL_APPS additions

```python
LOCAL_APPS = [
    # ... existing entries ...
    'apps.communications',
    'apps.channels',
]
```

### 8.2 `config/urls.py` — new include entries

```python
path('communications/', include('apps.communications.urls')),
path('channels/',       include('apps.channels.urls')),
```

Add within the existing `api/v1/` block.

### 8.3 New settings keys

Add to `config/settings/base.py`:

```python
# WhatsApp
WHATSAPP_PROVIDER       = os.environ.get('WHATSAPP_PROVIDER', 'sandbox')
WHATSAPP_VERIFY_TOKEN   = os.environ.get('WHATSAPP_VERIFY_TOKEN', '')
WHATSAPP_ACCESS_TOKEN   = os.environ.get('WHATSAPP_ACCESS_TOKEN', '')
WHATSAPP_PHONE_NUMBER_ID = os.environ.get('WHATSAPP_PHONE_NUMBER_ID', '')

# OTA webhook shared secrets — keyed by provider slug
OTA_WEBHOOK_TOKENS = {
    'dockwa':         os.environ.get('DOCKWA_WEBHOOK_TOKEN', ''),
    'pitchup':        os.environ.get('PITCHUP_WEBHOOK_TOKEN', ''),
    'snag_a_slip':    os.environ.get('SNAG_A_SLIP_WEBHOOK_TOKEN', ''),
    'rentals_united': os.environ.get('RENTALS_UNITED_WEBHOOK_TOKEN', ''),
}

# Fernet encryption key for EncryptedCharField (django-fernet-fields)
FERNET_KEYS = [os.environ.get('FERNET_KEY', '')]

# Widget booking_token JWT expiry (seconds)
WIDGET_BOOKING_TOKEN_EXPIRY_SECONDS = int(os.environ.get('WIDGET_BOOKING_TOKEN_EXPIRY', 7200))

# SMS provider
SMS_PROVIDER = os.environ.get('SMS_PROVIDER', 'twilio')
TWILIO_ACCOUNT_SID   = os.environ.get('TWILIO_ACCOUNT_SID', '')
TWILIO_AUTH_TOKEN    = os.environ.get('TWILIO_AUTH_TOKEN', '')
TWILIO_FROM_NUMBER   = os.environ.get('TWILIO_FROM_NUMBER', '')

# Dotdigital
DOTDIGITAL_API_BASE = 'https://r1-api.dotdigital.com'
```

### 8.4 `pip install` additions (add to `requirements.txt`)

```
django-fernet-fields>=0.6
celery>=5.3
```

`django-fernet-fields` provides `EncryptedCharField` for `OTAChannel.api_key` / `api_secret`. If using `cryptography` directly, generate a Fernet key: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` and set as `FERNET_KEY` env var.

---

## Part 9 — Migration Notes

1. `apps/communications/` — new app, `makemigrations communications` → `0001_initial.py`. This migration has FK dependencies on `accounts.Marina`, `members.Member`, `reservations.Booking`. These apps must be fully migrated first (they are).
2. `apps/channels/` — new app, `makemigrations channels`. Depends on `accounts.Marina`, `reservations.Booking`. Requires `django-fernet-fields` installed before running migration.
3. `apps/billing/` — `makemigrations billing` for `CouponCode` + `CouponRedemption`. These are additive, no data changes.
4. `apps/portal/` — `makemigrations portal` for `BookingWidgetConfig`. Additive.
5. `apps/accounts/` — `makemigrations accounts` for `MarinaGroup` + `MarinaGroupMembership` + `MarinaGroupUserRole`. Additive.
6. `apps/members/` — `makemigrations members` for `whatsapp_opt_in` field on `Member`. Additive with default `False`.

Run all migrations in order: `python manage.py migrate`.

---

## Part 10 — Implementation Order (Numbered Steps)

Execute in this order. Each step is independently deployable.

1. **Install dependencies.** `pip install django-fernet-fields celery`. Add to `requirements.txt`. Generate `FERNET_KEY` and add to `.env`.

2. **Scaffold `apps/communications/` and `apps/channels/`.** Create directory, `__init__.py`, `apps.py`, `migrations/__init__.py`. Register both in `LOCAL_APPS`. Add skeleton `urls.py` (empty router). Add includes to `config/urls.py`. Run `python manage.py check` — should pass.

3. **Write `apps/communications/models.py`** — all models in dependency order: `MessageLog`, `WhatsAppTemplate`, `Journey`, `JourneyStep`, `JourneyEnrollment`, `JourneyStepLog`, `AlertRoute`, `DotdigitalConfig`, `DotdigitalSegmentMapping`, `EmailCampaign`, `EmailCampaignVariant`, `ABTest`, `ReviewRequest`, `ReviewConfig`. Run `makemigrations communications`. Run `migrate`.

4. **Write `apps/channels/models.py`** — `OTAChannel`, `OTABooking`. Run `makemigrations channels`. Run `migrate`.

5. **Billing additions.** Append `CouponCode` + `CouponRedemption` to `apps/billing/models.py`. Run `makemigrations billing`. Run `migrate`.

6. **Portal additions.** Append `BookingWidgetConfig` to `apps/portal/models.py`. Run `makemigrations portal`. Run `migrate`.

7. **Accounts additions.** Append `MarinaGroup`, `MarinaGroupMembership`, `MarinaGroupUserRole` to `apps/accounts/models.py`. Run `makemigrations accounts`. Run `migrate`.

8. **Members addition.** Add `whatsapp_opt_in` to `Member` model. Run `makemigrations members`. Run `migrate`.

9. **Write settings keys** — add all keys from §8.3 to `base.py`. Add `.env` entries.

10. **Write `apps/communications/services/dispatch.py`** — unified dispatch function with email adapter calling `anymail` (existing). Create `apps/communications/adapters/` directory with `email.py` (thin wrapper over existing `anymail` path), `sms.py` (stub), `whatsapp.py` (stub), `slack_teams.py` (simple `requests.post` to webhook URL).

11. **Write `apps/communications/services/alert.py`** — `send_alert()` function. Wire to existing `billing.signals.invoice_paid` to test end-to-end dispatch path.

12. **Write `apps/communications/serializers.py` + `views.py` + `urls.py`** — `MessageLog` read-only ViewSet, `AlertRoute` CRUD ViewSet. Register in router. Test via `GET /api/v1/communications/messages/`.

13. **Write `apps/billing/` coupon views.** Add `CouponListCreateView`, `CouponDetailView`, `ValidateCouponView` to `billing/views.py`. Add URL patterns. Add `select_for_update()` redemption logic in the existing Stripe webhook handler (`billing/stripe_service.py`).

14. **Write journey engine backend.** `apps/communications/services/journey.py` — `enroll_in_journey()`, `condition_check()`, `advance_enrollment()`, `evaluate_all_due_enrollments()`. Write `apps/communications/tasks.py` — `evaluate_journey_steps` task. Write management command `apps/communications/management/commands/evaluate_journeys.py` as a manual runner.

15. **Write journey API.** `JourneyViewSet`, `JourneyStepViewSet`, `JourneyEnrollmentViewSet`. Add `activate`, `deactivate`, `enrollments`, `analytics` actions. Test journey creation, step creation, enrollment, and evaluation via API.

16. **Wire trigger signals for journeys.** In `apps/reservations/receivers.py`, add a `post_save` receiver on `Booking` that calls `enroll_in_journey()` for `BOOKING_CONFIRMED` and `BOOKING_CHECKOUT` triggers. In `apps/communications/signals.py`, add daily-task-triggered enrollment functions for `RENEWAL_DUE`, `INSURANCE_EXPIRING`, `DOCUMENT_UNSIGNED`.

17. **Write email campaign API.** `EmailCampaignViewSet` with `variants`, `ab-test`, `send`, `schedule` actions. `send_campaign_batch()` and `pick_ab_test_winner()` services. Tasks + management commands.

18. **Write Resend webhook handler** (`EmailWebhookView`). Map `email.opened` → `MessageLog.read_at`. Feed into A/B test winner logic and journey `prev_opened` condition.

19. **Write `apps/channels/ota/` adapter skeleton.** `base.py`, `factory.py`, `adapters/dockwa.py` (stub). Add `apps/channels/services/ota.py` — `handle_ota_webhook()`, `import_ota_booking()`. Write `OTAChannelViewSet` + webhook views. Test with mocked Dockwa payload.

20. **Add OTA delta sync signal** to `apps/reservations/receivers.py` (§5.2). Test: create a confirmed booking, assert `push_ota_availability_delta` task is queued (mock Celery).

21. **Write `apps/channels/tasks.py`** — `push_ota_availability`, `pull_ota_bookings`. Management commands.

22. **Implement Dockwa adapter** against Dockwa sandbox. Test full push/pull cycle.

23. **Write review solicitation.** `apps/communications/services/reviews.py` — `dispatch_pending_review_requests()`. `send_review_requests` Celery task + management command. `ReviewConfig` and `ReviewRequest` CRUD API.

24. **Write WhatsApp adapter.** `apps/communications/adapters/whatsapp.py` — `send_whatsapp_template()`, webhook signature verification. `WhatsAppWebhookView` with `X-Hub-Signature-256` verification. `WhatsAppTemplateViewSet` with `submit` action. Test against Meta sandbox.

25. **Write Dotdigital adapter.** `apps/communications/marketing/base.py` + `apps/communications/marketing/dotdigital.py`. `sync_dotdigital_segments` task.

26. **Write portal widget backend.** `BookingTokenAuthentication` DRF authentication class. `WidgetInitSessionView` (signs JWT), `WidgetAvailabilityView`, `WidgetBookingRequestView`, `WidgetConfirmPaymentView`. Validate `Origin` against `allowed_origins`. Test embed in a plain HTML page in Safari with ITP and Chrome with third-party cookies disabled.

27. **Write marina group management API** (§6.5). Scope `multi-site` report to group.

28. **Remaining OTA adapters** — PitchUp, Snag-A-Slip, Rentals United. Build in priority order.

29. **Admin registration** for all new models.

30. **Integration test for coupon race condition.** Simulate 30 concurrent requests against a coupon with `max_uses=10`. Assert `CouponRedemption.objects.count() == 10` after all complete.

---

## Part 11 — Management Commands (manual runners before Celery)

Each task needs a corresponding management command in `apps/<app>/management/commands/`:

| Command | Calls |
|---|---|
| `evaluate_journeys` | `evaluate_all_due_enrollments()` |
| `send_scheduled_campaigns` | `send_campaign_batch()` for all due campaigns |
| `pick_ab_winners` | `pick_ab_test_winner()` for all eligible tests |
| `send_review_requests` | `dispatch_pending_review_requests()` |
| `push_ota_availability` | batch push for all active channels |
| `pull_ota_bookings` | polling pull for all active channels |
| `sync_dotdigital` | `sync_all_segments()` |
| `trigger_renewal_journeys` | scan members, enroll |
| `trigger_insurance_journeys` | scan members, enroll |
| `trigger_unsigned_doc_journeys` | scan envelopes, enroll |

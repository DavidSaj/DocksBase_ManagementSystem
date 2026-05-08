from django.db import models


class MessageTemplate(models.Model):
    """
    Reusable message templates for email, SMS, and WhatsApp journeys/campaigns.
    Fields: name, channel, subject (email only), body (with {{variable}} placeholders).
    """
    class Channel(models.TextChoices):
        EMAIL    = 'email',    'Email'
        SMS      = 'sms',     'SMS'
        WHATSAPP = 'whatsapp', 'WhatsApp'

    marina     = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                   related_name='message_templates')
    name       = models.CharField(max_length=200)
    channel    = models.CharField(max_length=20, choices=Channel.choices, default=Channel.EMAIL)
    subject    = models.CharField(max_length=500, blank=True)
    body       = models.TextField()
    is_active  = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.channel})'


class MessageLog(models.Model):
    class Channel(models.TextChoices):
        EMAIL    = 'email',    'Email'
        SMS      = 'sms',     'SMS'
        WHATSAPP = 'whatsapp', 'WhatsApp'
        SLACK    = 'slack',   'Slack'
        TEAMS    = 'teams',   'Microsoft Teams'
        PUSH     = 'push',    'Push Notification'

    class Direction(models.TextChoices):
        OUTBOUND = 'outbound', 'Outbound'
        INBOUND  = 'inbound',  'Inbound'

    class Status(models.TextChoices):
        QUEUED    = 'queued',    'Queued'
        SENT      = 'sent',      'Sent'
        DELIVERED = 'delivered', 'Delivered'
        OPENED    = 'opened',    'Opened'
        CLICKED   = 'clicked',   'Clicked'
        FAILED    = 'failed',    'Failed'
        BOUNCED   = 'bounced',   'Bounced'

    marina              = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='message_logs')
    member              = models.ForeignKey('members.Member', null=True, blank=True, on_delete=models.SET_NULL, related_name='message_logs')
    booking             = models.ForeignKey('reservations.Booking', null=True, blank=True, on_delete=models.SET_NULL, related_name='message_logs')
    journey_step        = models.ForeignKey('JourneyStep', null=True, blank=True, on_delete=models.SET_NULL, related_name='message_logs')
    channel             = models.CharField(max_length=20, choices=Channel.choices)
    direction           = models.CharField(max_length=20, choices=Direction.choices, default=Direction.OUTBOUND)
    status              = models.CharField(max_length=20, choices=Status.choices, default=Status.QUEUED)
    recipient           = models.CharField(max_length=500)
    subject             = models.CharField(max_length=500, blank=True)
    body                = models.TextField(blank=True)
    provider_message_id = models.CharField(max_length=500, blank=True)
    failed_reason       = models.TextField(blank=True)
    sent_at             = models.DateTimeField(null=True, blank=True)
    created_at          = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'MessageLog {self.pk} — {self.channel} to {self.recipient} ({self.status})'


class WhatsAppTemplate(models.Model):
    class Status(models.TextChoices):
        DRAFT    = 'draft',    'Draft'
        PENDING  = 'pending',  'Pending Approval'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='whatsapp_templates')
    meta_name       = models.CharField(max_length=200)
    language_code   = models.CharField(max_length=10, default='en')
    body_text       = models.TextField()
    status          = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    rejection_reason = models.TextField(blank=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('marina', 'meta_name', 'language_code')]
        ordering = ['meta_name']

    def __str__(self):
        return f'{self.meta_name} ({self.language_code}) — {self.status}'


class Journey(models.Model):
    class TriggerEvent(models.TextChoices):
        BOOKING_CONFIRMED  = 'booking_confirmed',  'Booking Confirmed'
        BOOKING_CHECKOUT   = 'booking_checkout',   'Booking Checkout'
        RENEWAL_DUE        = 'renewal_due',         'Renewal Due'
        INSURANCE_EXPIRING = 'insurance_expiring',  'Insurance Expiring'
        INVOICE_OVERDUE    = 'invoice_overdue',     'Invoice Overdue'
        DOCUMENT_UNSIGNED  = 'document_unsigned',   'Document Unsigned'
        MANUAL             = 'manual',              'Manual'
        ACTIVITY_BOOKED    = 'activity_booked',     'Activity Booked'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='journeys')
    name          = models.CharField(max_length=200)
    trigger_event = models.CharField(max_length=40, choices=TriggerEvent.choices)
    is_active     = models.BooleanField(default=False)
    created_at    = models.DateTimeField(auto_now_add=True)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.trigger_event})'


class JourneyStep(models.Model):
    class Channel(models.TextChoices):
        EMAIL    = 'email',    'Email'
        SMS      = 'sms',     'SMS'
        WHATSAPP = 'whatsapp', 'WhatsApp'
        SLACK    = 'slack',   'Slack'
        TEAMS    = 'teams',   'Microsoft Teams'

    class StepType(models.TextChoices):
        ACTION = 'action', 'Send Message'
        GATE   = 'gate',   'Condition Gate'
        DELAY  = 'delay',  'Delay'

    class ConditionField(models.TextChoices):
        MEMBER_TYPE       = 'member_type',       'Member Type'
        INSURANCE_STATUS  = 'insurance_status',  'Insurance Status'
        DOCS_STATUS       = 'docs_status',       'Documents Status'
        BOOKING_STATUS    = 'booking_status',    'Booking Status'
        PAYMENT_STATUS    = 'payment_status',    'Payment Status'
        WHATSAPP_OPT_IN   = 'whatsapp_opt_in',   'WhatsApp Opt-In'

    class DelayUnit(models.TextChoices):
        MINUTES = 'minutes', 'Minutes'
        HOURS   = 'hours',   'Hours'
        DAYS    = 'days',    'Days'

    journey             = models.ForeignKey(Journey, on_delete=models.CASCADE, related_name='steps')
    order               = models.IntegerField(default=0)
    step_type           = models.CharField(max_length=20, choices=StepType.choices, default=StepType.ACTION)
    channel             = models.CharField(max_length=20, choices=Channel.choices, blank=True)
    delay_value         = models.IntegerField(default=0)
    delay_unit          = models.CharField(max_length=10, choices=DelayUnit.choices, default=DelayUnit.HOURS)
    condition_field     = models.CharField(max_length=40, choices=ConditionField.choices, blank=True)
    condition_operator  = models.CharField(max_length=20, blank=True)
    condition_value     = models.CharField(max_length=200, blank=True)
    body_template       = models.TextField(blank=True)
    subject_template    = models.CharField(max_length=500, blank=True)
    whatsapp_template   = models.ForeignKey(
        WhatsAppTemplate, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='journey_steps',
    )

    class Meta:
        unique_together = [('journey', 'order')]
        ordering = ['journey', 'order']

    def __str__(self):
        return f'Step {self.order} of {self.journey.name} ({self.step_type})'


class JourneyEnrollment(models.Model):
    class Status(models.TextChoices):
        ACTIVE    = 'active',    'Active'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'
        FAILED    = 'failed',    'Failed'

    journey           = models.ForeignKey(Journey, on_delete=models.CASCADE, related_name='enrollments')
    member            = models.ForeignKey('members.Member', null=True, blank=True, on_delete=models.SET_NULL, related_name='journey_enrollments')
    booking           = models.ForeignKey('reservations.Booking', null=True, blank=True, on_delete=models.SET_NULL, related_name='journey_enrollments')
    status            = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    current_step_order = models.IntegerField(default=0)
    next_step_due_at  = models.DateTimeField(null=True, blank=True)
    enrolled_at       = models.DateTimeField(auto_now_add=True)
    completed_at      = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-enrolled_at']

    def __str__(self):
        return f'Enrollment {self.pk} — {self.journey.name} ({self.status})'


class JourneyStepLog(models.Model):
    enrollment       = models.ForeignKey(JourneyEnrollment, on_delete=models.CASCADE, related_name='step_logs')
    journey_step     = models.ForeignKey(JourneyStep, on_delete=models.CASCADE, related_name='step_logs')
    message_log      = models.ForeignKey(MessageLog, null=True, blank=True, on_delete=models.SET_NULL, related_name='step_logs')
    skipped          = models.BooleanField(default=False)
    gate_timed_out   = models.BooleanField(default=False)
    executed_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['executed_at']

    def __str__(self):
        return f'StepLog {self.pk} — enrollment {self.enrollment_id} step {self.journey_step.order}'


class AlertRoute(models.Model):
    class Platform(models.TextChoices):
        SLACK = 'slack', 'Slack'
        TEAMS = 'teams', 'Microsoft Teams'

    class AlertType(models.TextChoices):
        NEW_BOOKING         = 'new_booking',         'New Booking'
        PAYMENT_FAILURE     = 'payment_failure',     'Payment Failure'
        CRITICAL_DEFECT     = 'critical_defect',     'Critical Defect'
        STOCK_LOW           = 'stock_low',           'Stock Low'
        OVERSTAY            = 'overstay',            'Overstay'
        REVIEW_NEGATIVE     = 'review_negative',     'Negative Review'
        INSTRUCTOR_CONFLICT = 'instructor_conflict', 'Instructor Conflict'

    marina     = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='alert_routes')
    platform   = models.CharField(max_length=20, choices=Platform.choices)
    alert_type = models.CharField(max_length=40, choices=AlertType.choices)
    webhook_url = models.URLField(max_length=1000)
    is_active  = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'platform', 'alert_type')]
        ordering = ['marina', 'alert_type']

    def __str__(self):
        return f'{self.marina} — {self.platform}/{self.alert_type}'


class DotdigitalConfig(models.Model):
    marina          = models.OneToOneField('accounts.Marina', on_delete=models.CASCADE, related_name='dotdigital_config')
    api_username    = models.CharField(max_length=200)
    api_password    = models.CharField(max_length=500)  # plain — see INSTALL.md for encryption note
    region          = models.CharField(max_length=10, default='r1')
    address_book_id = models.CharField(max_length=100, blank=True)
    last_sync_at    = models.DateTimeField(null=True, blank=True)
    sync_enabled    = models.BooleanField(default=False)

    def __str__(self):
        return f'DotdigitalConfig — {self.marina}'


class DotdigitalSegmentMapping(models.Model):
    marina             = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='dotdigital_segment_mappings')
    segment            = models.ForeignKey('members.Segment', on_delete=models.CASCADE, related_name='dotdigital_mappings')
    dotdigital_book_id = models.CharField(max_length=100)
    last_sync_at       = models.DateTimeField(null=True, blank=True)
    last_sync_count    = models.IntegerField(default=0)

    class Meta:
        unique_together = [('marina', 'segment')]

    def __str__(self):
        return f'{self.segment.name} → {self.dotdigital_book_id}'


class EmailCampaign(models.Model):
    class Status(models.TextChoices):
        DRAFT     = 'draft',     'Draft'
        SCHEDULED = 'scheduled', 'Scheduled'
        SENDING   = 'sending',   'Sending'
        SENT      = 'sent',      'Sent'
        CANCELLED = 'cancelled', 'Cancelled'

    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='email_campaigns')
    segment      = models.ForeignKey('members.Segment', null=True, blank=True, on_delete=models.SET_NULL, related_name='email_campaigns')
    name         = models.CharField(max_length=200)
    status       = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    scheduled_at = models.DateTimeField(null=True, blank=True)
    sent_at      = models.DateTimeField(null=True, blank=True)
    total_sent   = models.IntegerField(default=0)
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} ({self.status})'


class EmailCampaignVariant(models.Model):
    campaign   = models.ForeignKey(EmailCampaign, on_delete=models.CASCADE, related_name='variants')
    label      = models.CharField(max_length=10)  # A / B
    subject    = models.CharField(max_length=500)
    body_html  = models.TextField()
    split_pct  = models.IntegerField(default=50)
    sent_count = models.IntegerField(default=0)
    open_count = models.IntegerField(default=0)
    click_count = models.IntegerField(default=0)

    @property
    def open_rate(self):
        return (self.open_count / self.sent_count * 100) if self.sent_count else 0

    @property
    def click_rate(self):
        return (self.click_count / self.sent_count * 100) if self.sent_count else 0

    class Meta:
        unique_together = [('campaign', 'label')]

    def __str__(self):
        return f'{self.campaign.name} — Variant {self.label}'


class ABTest(models.Model):
    class WinnerMetric(models.TextChoices):
        OPEN_RATE  = 'open_rate',  'Open Rate'
        CLICK_RATE = 'click_rate', 'Click Rate'

    class WinnerAction(models.TextChoices):
        AUTO_SEND = 'auto_send', 'Auto-Send to Remainder'
        ALERT     = 'alert',    'Alert Only'

    campaign        = models.OneToOneField(EmailCampaign, on_delete=models.CASCADE, related_name='ab_test')
    test_split_pct  = models.IntegerField(default=50)
    hold_hours      = models.IntegerField(default=24)
    winner_metric   = models.CharField(max_length=20, choices=WinnerMetric.choices, default=WinnerMetric.OPEN_RATE)
    winner_action   = models.CharField(max_length=20, choices=WinnerAction.choices, default=WinnerAction.AUTO_SEND)
    winner_variant  = models.ForeignKey(EmailCampaignVariant, null=True, blank=True, on_delete=models.SET_NULL, related_name='won_tests')
    winner_sent_at  = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f'ABTest for {self.campaign.name}'


class ReviewRequest(models.Model):
    class Platform(models.TextChoices):
        GOOGLE      = 'google',      'Google'
        TRIPADVISOR = 'tripadvisor', 'TripAdvisor'
        DOCKWA      = 'dockwa',      'Dockwa'

    class Status(models.TextChoices):
        SENT      = 'sent',      'Sent'
        OPENED    = 'opened',    'Opened'
        CLICKED   = 'clicked',   'Clicked'
        RESPONDED = 'responded', 'Responded'

    marina     = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='review_requests')
    booking    = models.ForeignKey('reservations.Booking', null=True, blank=True, on_delete=models.SET_NULL, related_name='review_requests')
    member     = models.ForeignKey('members.Member', null=True, blank=True, on_delete=models.SET_NULL, related_name='review_requests')
    platform   = models.CharField(max_length=20, choices=Platform.choices)
    status     = models.CharField(max_length=20, choices=Status.choices, default=Status.SENT)
    sent_at    = models.DateTimeField(auto_now_add=True)
    opened_at  = models.DateTimeField(null=True, blank=True)
    clicked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-sent_at']

    def __str__(self):
        return f'ReviewRequest {self.pk} — {self.platform} ({self.status})'


class ReviewConfig(models.Model):
    class SendChannel(models.TextChoices):
        EMAIL    = 'email',    'Email'
        SMS      = 'sms',     'SMS'
        WHATSAPP = 'whatsapp', 'WhatsApp'

    marina              = models.OneToOneField('accounts.Marina', on_delete=models.CASCADE, related_name='review_config')
    enabled             = models.BooleanField(default=False)
    delay_hours         = models.IntegerField(default=24)
    google_review_url   = models.URLField(blank=True)
    tripadvisor_url     = models.URLField(blank=True)
    dockwa_url          = models.URLField(blank=True)
    send_channel        = models.CharField(max_length=20, choices=SendChannel.choices, default=SendChannel.EMAIL)
    negative_threshold  = models.IntegerField(default=3, help_text='NPS score at or below which review request is suppressed')

    def __str__(self):
        return f'ReviewConfig — {self.marina}'

from django.db import models
from apps.accounting.fields import EncryptedCharField  # NOT fernet_fields — that's broken on Django 6


class OTAChannel(models.Model):
    class Provider(models.TextChoices):
        RENTALS_UNITED = 'rentals_united', 'Rentals United'
        PITCHUP        = 'pitchup',        'PitchUp'
        SNAG_A_SLIP    = 'snag_a_slip',    'Snag-A-Slip'
        DOCKWA         = 'dockwa',         'Dockwa'
        MYSEA          = 'mysea',          'MySea'
        NOFOREIGNLAND  = 'noforeignland',  'Noforeignland'

    class PricingPolicy(models.TextChoices):
        PARITY   = 'parity',   'Rate Parity'
        MARKUP   = 'markup',   'Fixed Markup (%)'
        DISCOUNT = 'discount', 'Fixed Discount (%)'

    marina            = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    provider          = models.CharField(max_length=40, choices=Provider.choices)
    is_active         = models.BooleanField(default=False)
    api_key           = EncryptedCharField(max_length=500)
    api_secret        = EncryptedCharField(max_length=500)
    property_id       = models.CharField(max_length=200, blank=True)
    pricing_policy    = models.CharField(max_length=20, choices=PricingPolicy.choices, default=PricingPolicy.PARITY)
    pricing_delta_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    last_push_at      = models.DateTimeField(null=True, blank=True)
    last_pull_at      = models.DateTimeField(null=True, blank=True)
    created_at        = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'provider')]

    def __str__(self):
        return f'{self.marina} — {self.provider}'


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

    def __str__(self):
        return f'OTABooking {self.ota_ref} via {self.channel.provider}'

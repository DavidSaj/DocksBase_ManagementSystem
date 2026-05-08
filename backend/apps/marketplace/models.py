from django.core.exceptions import ValidationError
from django.db import models


class BerthListing(models.Model):
    STATUS_CHOICES = [
        ('draft',       'Draft'),
        ('published',   'Published'),
        ('under_offer', 'Under Offer'),
        ('sold',        'Sold'),
        ('withdrawn',   'Withdrawn'),
    ]
    LISTING_PARTY_CHOICES = [
        ('member', 'Berth Holder'),
        ('marina', 'Marina'),
    ]

    marina                  = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='marketplace_listings')
    berth                   = models.ForeignKey('berths.Berth', on_delete=models.PROTECT, related_name='marketplace_berth_listings')
    listing_party           = models.CharField(max_length=10, choices=LISTING_PARTY_CHOICES, default='member')
    listed_by_member        = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='marketplace_listed_berths')
    status                  = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    headline                = models.CharField(max_length=200, blank=True)
    description             = models.TextField(blank=True)
    asking_price            = models.DecimalField(max_digits=12, decimal_places=2)
    show_asking_price       = models.BooleanField(default=False)
    licence_transfer_terms  = models.TextField(blank=True)
    length_m                = models.DecimalField(max_digits=6, decimal_places=1, null=True, blank=True)
    max_beam_m              = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    max_draft_m             = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    has_power               = models.BooleanField(default=False)
    has_water               = models.BooleanField(default=False)
    publish_to_portal       = models.BooleanField(default=True)
    publish_to_network      = models.BooleanField(default=False)
    publish_to_third_party  = models.BooleanField(default=False)
    sale_price              = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    sold_to_member          = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='marketplace_purchased_berths')
    transfer_date           = models.DateField(null=True, blank=True)
    published_at            = models.DateTimeField(null=True, blank=True)
    created_at              = models.DateTimeField(auto_now_add=True)
    updated_at              = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Listing: {self.berth} — {self.get_status_display()}'


class BerthListingPhoto(models.Model):
    listing     = models.ForeignKey(BerthListing, on_delete=models.CASCADE, related_name='photos')
    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='marketplace_listing_photos')
    file        = models.ImageField(upload_to='berth_listing_photos/')
    caption     = models.CharField(max_length=200, blank=True)
    sort_order  = models.IntegerField(default=0)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['sort_order', 'uploaded_at']


class BerthEnquiry(models.Model):
    STATUS_CHOICES = [
        ('new',       'New'),
        ('contacted', 'Contacted'),
        ('closed',    'Closed'),
    ]

    listing         = models.ForeignKey(BerthListing, on_delete=models.CASCADE, related_name='enquiries')
    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='marketplace_berth_enquiries')
    enquirer_member = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='marketplace_berth_enquiries')
    enquirer_name   = models.CharField(max_length=200, blank=True)
    enquirer_email  = models.EmailField(blank=True)
    enquirer_phone  = models.CharField(max_length=30, blank=True)
    message         = models.TextField(blank=True)
    status          = models.CharField(max_length=20, choices=STATUS_CHOICES, default='new')
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class ExchangeListing(models.Model):
    STATUS_CHOICES = [
        ('available', 'Available'),
        ('matched',   'Matched'),
        ('expired',   'Expired'),
        ('withdrawn', 'Withdrawn'),
    ]

    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='exchange_listings')
    berth            = models.ForeignKey('berths.Berth', on_delete=models.PROTECT, related_name='exchange_listings')
    member           = models.ForeignKey('members.Member', on_delete=models.PROTECT, related_name='exchange_listings')
    status           = models.CharField(max_length=20, choices=STATUS_CHOICES, default='available')
    available_from   = models.DateField()
    available_to     = models.DateField()
    notes            = models.TextField(blank=True)
    desired_location = models.CharField(max_length=500, blank=True)
    network_visible  = models.BooleanField(default=False)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class ExchangeAgreement(models.Model):
    STATUS_CHOICES = [
        ('pending',   'Pending Signature'),
        ('agreed',    'Agreed'),
        ('cancelled', 'Cancelled'),
    ]

    marina             = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='exchange_agreements')
    listing_a          = models.ForeignKey(ExchangeListing, on_delete=models.PROTECT, related_name='agreements_as_a')
    listing_b          = models.ForeignKey(ExchangeListing, on_delete=models.PROTECT, related_name='agreements_as_b')
    status             = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    party_a_start_date = models.DateField()
    party_a_end_date   = models.DateField()
    party_b_start_date = models.DateField()
    party_b_end_date   = models.DateField()
    agreed_at          = models.DateTimeField(null=True, blank=True)
    document           = models.FileField(upload_to='exchange_agreements/', null=True, blank=True)
    created_at         = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def clean(self):
        if self.party_a_start_date and self.party_a_end_date and self.party_a_start_date >= self.party_a_end_date:
            raise ValidationError({'party_a_end_date': 'Party A end date must be after start date.'})
        if self.party_b_start_date and self.party_b_end_date and self.party_b_start_date >= self.party_b_end_date:
            raise ValidationError({'party_b_end_date': 'Party B end date must be after start date.'})
        if self.listing_a_id:
            la = self.listing_a
            if self.party_b_start_date < la.available_from or self.party_b_end_date > la.available_to:
                raise ValidationError("Party B dates fall outside listing A's availability window.")
        if self.listing_b_id:
            lb = self.listing_b
            if self.party_a_start_date < lb.available_from or self.party_a_end_date > lb.available_to:
                raise ValidationError("Party A dates fall outside listing B's availability window.")

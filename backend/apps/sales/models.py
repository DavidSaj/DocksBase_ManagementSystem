from django.db import models


class Listing(models.Model):
    STATUS = [('active', 'Active'), ('under_offer', 'Under Offer'), ('sold', 'Sold'), ('withdrawn', 'Withdrawn')]
    TYPE = [('motor', 'Motor'), ('sail', 'Sail'), ('catamaran', 'Catamaran'), ('other', 'Other')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='listings')
    name = models.CharField(max_length=300)
    vessel_type = models.CharField(max_length=20, choices=TYPE, default='motor')
    make = models.CharField(max_length=200, blank=True)
    model = models.CharField(max_length=200, blank=True)
    loa = models.DecimalField(max_digits=6, decimal_places=1, null=True, blank=True)
    year = models.IntegerField(null=True, blank=True)
    price = models.DecimalField(max_digits=12, decimal_places=2)
    commission_pct = models.DecimalField(max_digits=5, decimal_places=2, default=10)
    owner = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True)
    location = models.CharField(max_length=200, blank=True)
    highlights = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=20, choices=STATUS, default='active')
    listed_at = models.DateField(auto_now_add=True)


class Lead(models.Model):
    STAGE = [
        ('new', 'New'), ('contacted', 'Contacted'), ('viewing_scheduled', 'Viewing Scheduled'),
        ('viewing_completed', 'Viewing Completed'), ('offer_made', 'Offer Made'), ('sale_agreed', 'Sale Agreed'),
    ]
    SOURCE = [('website', 'Website'), ('referral', 'Referral'), ('walk_in', 'Walk-in'), ('broker', 'Broker'), ('other', 'Other')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='leads')
    name = models.CharField(max_length=200)
    contact = models.CharField(max_length=200, blank=True)
    listing = models.ForeignKey(Listing, on_delete=models.SET_NULL, null=True, blank=True)
    budget = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    stage = models.CharField(max_length=30, choices=STAGE, default='new')
    source = models.CharField(max_length=20, choices=SOURCE, default='other')
    notes = models.TextField(blank=True)
    last_contact = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

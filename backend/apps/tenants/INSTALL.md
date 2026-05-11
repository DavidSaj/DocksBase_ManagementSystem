# Track 10 — INSTALL.md

## Changes needed AFTER all parallel agents complete

### 1. config/settings/base.py — Add to LOCAL_APPS

```python
'apps.tenants',
'apps.marketplace',
```

### 2. config/urls.py — Add to api/v1/ include block

```python
path('', include('apps.tenants.urls')),
path('', include('apps.marketplace.urls')),
```

### 3. apps/billing/models.py — Add tenant FK to Invoice model

After the existing `member` FK, add:

```python
tenant = models.ForeignKey(
    'tenants.TenantContact',
    on_delete=models.SET_NULL,
    null=True, blank=True,
    related_name='invoices',
)
```

Then run: `python manage.py makemigrations billing`

**Note**: Until this migration is applied, `apps/tenants/signals.py` and
`apps/tenants/services/rent_scheduler.py` and `apps/tenants/services/deposit_service.py`
will fail at runtime when they attempt to create Invoice objects with `tenant=...`.

### 4. apps/berths/models.py — Add ownership fields to Berth model

```python
owner = models.ForeignKey(
    'members.Member',
    on_delete=models.SET_NULL,
    null=True, blank=True,
    related_name='owned_berths',
)
lease_expiry = models.DateField(null=True, blank=True)
```

Then run: `python manage.py makemigrations berths`

**Note**: `apps/marketplace/views.py BerthListingMarkSoldView` currently clears
`berth.vessel` on sale. Once `Berth.owner` is added, update that view to also
set `berth.owner = sold_to`.

### 5. apps/reservations/models.py — Add OTA commission field to Booking

```python
ota_commission_amount = models.DecimalField(
    max_digits=8, decimal_places=2,
    null=True, blank=True,
    help_text='OTA commission amount retained by the channel.',
)
```

Then run: `python manage.py makemigrations reservations`

### Migration order (run after all per-app makemigrations above)

```
python manage.py migrate
```

---

## Notes on related_name changes from spec

The marketplace app's `BerthListing` model uses different related_names than specified
in the Track 10 spec, because `apps/berths/models.py` already defines its own
`BerthListing` model that occupies the following related_names:

- `Marina.berth_listings` (used by `berths.BerthListing`)
- `Member.berth_listings` (used by `berths.BerthListing`)
- `Berth.listing` (OneToOneField, used by `berths.BerthListing`)
- `Marina.berth_listing_enquiries` (used by `berths.BerthListingEnquiry`)
- `Member.berth_enquiries` (used by `berths.BerthListingEnquiry`)

The marketplace models therefore use:
- `Marina` → `marketplace_listings`
- `Berth` → `marketplace_berth_listings`
- `Member` (listed_by) → `marketplace_listed_berths`
- `Member` (sold_to) → `marketplace_purchased_berths`
- `Marina` (enquiries) → `marketplace_berth_enquiries`
- `Member` (enquiries) → `marketplace_berth_enquiries`
- `Marina` (photos) → `marketplace_listing_photos`

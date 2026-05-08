# Track 9 — Charter & Commercial Harbour: Wiring Instructions

Generated: 2026-05-08

---

## 1. Python dependencies

Install `django-model-utils` (used by `FieldTracker` in `CharterBooking`):

```bash
pip install django-model-utils
```

Add to `requirements.txt`:
```
django-model-utils>=4.3
```

---

## 2. `config/settings/base.py` — LOCAL_APPS

Add both apps to `LOCAL_APPS`:

```python
LOCAL_APPS = [
    # … existing apps …
    'apps.charter',
    'apps.harbour',
]
```

---

## 3. `config/urls.py` — URL includes

Inside the `api/v1/` path group, add:

```python
from django.urls import path, include

urlpatterns = [
    # … existing includes …
    path('api/v1/', include([
        # … existing …
        path('', include('apps.charter.urls')),
        path('', include('apps.harbour.urls')),
    ])),
]
```

---

## 4. Environment variables (`.env` / settings)

Add the following to your `.env` and to `config/settings/base.py`:

```env
ZIZOO_WEBHOOK_SECRET=<your-zizoo-hmac-secret>
CLICK_AND_BOAT_WEBHOOK_SECRET=<your-clickandboat-hmac-secret>
```

In `base.py`:
```python
ZIZOO_WEBHOOK_SECRET        = env('ZIZOO_WEBHOOK_SECRET', default='')
CLICK_AND_BOAT_WEBHOOK_SECRET = env('CLICK_AND_BOAT_WEBHOOK_SECRET', default='')
```

---

## 5. Billing model changes

The following fields were added to `apps/billing/models.py`.
Run `makemigrations billing` to generate the migration.

### ChargeableItem.Category — new choice:
```python
HARBOUR_TARIFF = 'harbour_tariff', 'Harbour Tariff'
```

### ChargeableItem.PricingModel — new choices:
```python
PER_WEEK         = 'per_week',         'Per Week'
PER_PASSENGER    = 'per_passenger',    'Per Passenger'
PER_GROSS_TON    = 'per_gross_ton',    'Per Gross Ton'
PER_TON_DISTANCE = 'per_ton_distance', 'Per Ton × Distance'
```

### Invoice — new fields:
```python
invoice_type    = CharField(max_length=20, choices=[('invoice','Invoice'),('credit_note','Credit Note')], default='invoice')
related_invoice = ForeignKey('self', SET_NULL, null=True, blank=True, related_name='credit_notes')
tenant          = ForeignKey('tenants.TenantContact', SET_NULL, null=True, blank=True, related_name='invoices')
shipping_agent  = ForeignKey('harbour.ShippingAgent', SET_NULL, null=True, blank=True, related_name='invoices')
```

Note: `tenant` uses a string reference so it resolves lazily when Track 10 merges.
Note: `shipping_agent` creates a forward reference to `harbour.ShippingAgent`.
      Because `harbour` is in LOCAL_APPS, Django resolves this at startup.
      Migration order matters: run `makemigrations billing` *before* `makemigrations harbour`
      only if you need billing to be independent; otherwise run both and Django handles deps.

---

## 6. Staff model changes

`apps/staff/models.py` — new field added to `StaffMember`:
```python
is_contractor = BooleanField(default=False)
```

Run `makemigrations staff`.

Update any payroll/HR list views that should exclude contractors by default:
```python
StaffMember.objects.filter(marina=..., is_contractor=False)  # default
# Show all: StaffMember.objects.filter(marina=...)
```

---

## 7. Documents model changes

`apps/documents/models.py` — `DocTemplate.CATEGORY` now includes:
```python
('charter_agreement', 'Charter Agreement'),
```

Run `makemigrations documents`.

---

## 8. Migration order

Run migrations in this order to respect FK dependencies:

```bash
python manage.py makemigrations billing
python manage.py makemigrations staff
python manage.py makemigrations documents
python manage.py makemigrations charter
python manage.py makemigrations harbour
python manage.py migrate
```

All migrations are additive — no existing data is modified.

---

## 9. API URL summary

### Charter endpoints (prefix: `/api/v1/`)
| Method | URL | Name |
|--------|-----|------|
| GET/POST | `charter/vessels/` | charter-vessel-list |
| GET/PUT/PATCH/DELETE | `charter/vessels/<pk>/` | charter-vessel-detail |
| GET/POST | `charter/agreements/` | charter-agreement-list |
| GET/PUT/PATCH/DELETE | `charter/agreements/<pk>/` | charter-agreement-detail |
| GET/POST | `charter/bookings/` | charter-booking-list |
| GET/PUT/PATCH/DELETE | `charter/bookings/<pk>/` | charter-booking-detail |
| POST | `charter/bookings/<pk>/send-agreement/` | charter-booking-send-agreement |
| POST | `charter/bookings/<pk>/release-deposit/` | charter-booking-release-deposit |
| GET | `charter/commissions/` | charter-commission-list |
| GET/PUT/PATCH | `charter/commissions/<pk>/` | charter-commission-detail |
| GET/POST | `charter/rental-units/` | rental-unit-list |
| GET/PUT/PATCH/DELETE | `charter/rental-units/<pk>/` | rental-unit-detail |
| GET | `charter/rental-bookings/availability/` | rental-booking-availability |
| GET/POST | `charter/rental-bookings/` | rental-booking-list |
| GET/PUT/PATCH/DELETE | `charter/rental-bookings/<pk>/` | rental-booking-detail |
| POST | `charter/webhooks/zizoo/` | charter-webhook-zizoo |
| POST | `charter/webhooks/click-and-boat/` | charter-webhook-click-and-boat |
| POST | `charter/webhooks/dropboxsign/` | charter-webhook-dropboxsign |

### Harbour endpoints (prefix: `/api/v1/`)
| Method | URL | Name |
|--------|-----|------|
| GET/POST | `harbour/agents/` | harbour-agent-list |
| GET/PUT/PATCH/DELETE | `harbour/agents/<pk>/` | harbour-agent-detail |
| GET/POST | `harbour/tariffs/` | harbour-tariff-list |
| GET/PUT/PATCH/DELETE | `harbour/tariffs/<pk>/` | harbour-tariff-detail |
| GET/POST | `harbour/movements/` | harbour-movement-list |
| GET/PUT/PATCH/DELETE | `harbour/movements/<pk>/` | harbour-movement-detail |
| GET | `harbour/movements/<pk>/calculate-dues/` | harbour-movement-calculate-dues |
| POST | `harbour/movements/<pk>/generate-invoice/` | harbour-movement-generate-invoice |
| GET/POST | `harbour/psc-records/` | harbour-psc-list |
| GET/PUT/PATCH/DELETE | `harbour/psc-records/<pk>/` | harbour-psc-detail |
| GET | `harbour/reports/vessel-traffic/` | harbour-report-vtr |
| GET | `harbour/reports/daily-port-report/` | harbour-report-dpr |

---

## 10. OTA vessel mapping

Before OTA webhooks can route to the correct `CharterVessel`, create
`CharterVesselOTAMapping` records via the admin at:

`/_platform/admin/charter/chartervessel otamapping/`

Fields: `marina`, `charter_vessel`, `channel` (e.g. `zizoo`), `ota_vessel_id`.

---

## 11. Feature flags

The plan specifies `marina.charter_enabled` / `marina.harbour_enabled` flags.
These are not yet on the `Marina` model. Add them in a future migration or
in the Track 9 follow-up:

```python
# apps/accounts/models.py — Marina
charter_enabled = models.BooleanField(default=False)
harbour_enabled = models.BooleanField(default=False)
```

Until then, all marinas have full access to both apps' endpoints.

---

## 12. Smoke-test checklist (manual)

1. Admin: create a `CharterVessel` linked to an existing `Vessel`.
2. Admin: create a `CharterManagementAgreement` at 100% for that vessel.
3. POST `charter/bookings/` with status=`confirmed` → verify `CharterAgentCommission` record created.
4. PATCH `charter/bookings/<pk>/` to change `subtotal` → verify commission_amount updated.
5. POST `harbour/movements/` with ETA, gross_tonnage, passenger_count.
6. GET `harbour/movements/<pk>/calculate-dues/` → verify JSON preview with 5 due-type branches.
7. POST `harbour/movements/<pk>/generate-invoice/` → verify `HarbourDueInvoice` + `billing.Invoice` created.
8. Edit the movement (change passenger_count), POST generate-invoice again →
   verify credit note + new invoice in DB (original unchanged).

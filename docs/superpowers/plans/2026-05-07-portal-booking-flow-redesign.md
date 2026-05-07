# Portal Booking Flow Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `BerthCategory` (named berth tiers with amenities), redesign the `/portal` booking flow to match the dark navy/gold webmock, and clean up wrongly-added portal code from the management frontend.

**Architecture:** New `BerthCategory` model groups berths by product type (Standard, Premium, Mooring Ball); two new public endpoints serve categories and create Stripe PaymentIntents; the portal booking flow gains an Options screen between Search and Guest Details; the management frontend's `BoaterPortal` screen and its rogue CSS block are removed.

**Tech Stack:** Django/DRF (backend), React 19 (portal + management frontend), @stripe/react-stripe-js (portal), pytest (backend tests), vitest + @testing-library/react (portal tests).

---

## File Map

**Backend — create/modify:**
- `backend/apps/berths/models.py` — add `BerthCategory`, add `category` FK on `Berth`
- `backend/apps/berths/migrations/0026_berth_category.py` — generated migration
- `backend/apps/reservations/migrations/0010_booking_dates_index.py` — DB index
- `backend/apps/berths/serializers.py` — add `BerthCategorySerializer`
- `backend/apps/berths/views.py` — add `BerthCategoryViewSet` (management CRUD)
- `backend/apps/berths/urls.py` — register `/berth-categories/` routes
- `backend/apps/portal/public_booking_views.py` — add `PublicBerthCategoriesView`, `PublicBerthIntentView`; modify `PublicEngineRequestView`
- `backend/apps/portal/public_urls.py` — register new public endpoints
- `backend/apps/billing/stripe_service.py` — add `create_payment_intent()`

**Backend — test:**
- `backend/apps/berths/tests/test_berth_category.py` — new test file (model validation, management API)
- `backend/apps/portal/tests/test_public_booking.py` — extend with categories + intent tests

**Management frontend — delete:**
- `frontend/src/screens/BoaterPortal.jsx`
- `frontend/src/components/portal/PaymentModal.jsx`

**Management frontend — modify:**
- `frontend/src/styles/app.css` — remove portal CSS block (~lines 442–740)
- `frontend/src/App.jsx` — remove `/portal` route + import
- `frontend/src/screens/Login.jsx` — redirect boaters to portal URL
- `frontend/src/screens/ServiceCatalogScreen.jsx` — add Berth Categories tab
- `frontend/src/hooks/useBerthCategories.js` — new hook for category CRUD

**Portal — create:**
- `portal/src/styles/portal.css` — dark navy design tokens + utility classes
- `portal/src/screens/OptionsScreen.jsx` — berth category selection cards

**Portal — modify:**
- `portal/package.json` — add @stripe/stripe-js, @stripe/react-stripe-js
- `portal/src/main.jsx` — import portal.css
- `portal/src/screens/SearchScreen.jsx` — redesign to dark theme
- `portal/src/screens/QuoteScreen.jsx` — redesign with Stripe PaymentElement
- `portal/src/screens/BookingWizard.jsx` — insert 'options' state, wire intent
- `portal/src/screens/BookingConfirmed.jsx` — dark theme
- `portal/src/screens/BookingRequestSent.jsx` — dark theme

---

## Task 1: BerthCategory model + migration

**Files:**
- Modify: `backend/apps/berths/models.py`
- Create: `backend/apps/berths/migrations/0026_berth_category.py` (generated)

- [ ] **Step 1: Add BerthCategory and category FK to Berth in models.py**

Open `backend/apps/berths/models.py`. After the `OTAConnection` class and before the `Pier` class, insert:

```python
AMENITY_SLUGS = {'power_30a', 'power_50a', 'water', 'wifi', 'fuel_nearby', 'pump_out'}


class BerthCategory(models.Model):
    MOORING_CHOICES = [
        ('finger',       'Finger Pontoon'),
        ('alongside',    'Alongside'),
        ('stern_to',     'Stern-to'),
        ('mooring_ball', 'Mooring Ball'),
    ]
    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='berth_categories')
    name         = models.CharField(max_length=100)
    description  = models.TextField(blank=True)
    mooring_type = models.CharField(max_length=20, choices=MOORING_CHOICES, default='finger')
    amenities    = models.JSONField(default=list)
    pricing_tier = models.ForeignKey(
        'billing.ChargeableItem',
        on_delete=models.PROTECT,
        limit_choices_to={'category': 'berth'},
        null=True, blank=True,
        related_name='berth_categories',
    )
    sort_order = models.IntegerField(default=0)
    is_active  = models.BooleanField(default=True)

    class Meta:
        ordering = ['sort_order', 'name']
        unique_together = ('marina', 'name')

    def clean(self):
        from django.core.exceptions import ValidationError
        bad = [s for s in (self.amenities or []) if s not in AMENITY_SLUGS]
        if bad:
            raise ValidationError({'amenities': f'Unknown amenity slug(s): {bad}. Allowed: {sorted(AMENITY_SLUGS)}'})

    def __str__(self):
        return f'{self.name} ({self.marina})'
```

Then in the `Berth` class, add after the `ota_connection` field:

```python
    category = models.ForeignKey(
        BerthCategory,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='berths',
    )
```

- [ ] **Step 2: Generate migration**

```bash
cd backend
python manage.py makemigrations berths --name berth_category
```

Expected output: `Migrations for 'berths': apps/berths/migrations/0026_berth_category.py`

- [ ] **Step 3: Apply migration**

```bash
python manage.py migrate berths
```

Expected: `Applying berths.0026_berth_category... OK`

- [ ] **Step 4: Commit**

```bash
git add backend/apps/berths/models.py backend/apps/berths/migrations/0026_berth_category.py
git commit -m "feat(berths): add BerthCategory model with amenity validation"
```

---

## Task 2: DB index on Booking.check_in / check_out

**Files:**
- Create: `backend/apps/reservations/migrations/0010_booking_dates_index.py` (generated)

- [ ] **Step 1: Add index via migration**

```bash
cd backend
python manage.py makemigrations reservations --name booking_dates_index
```

If Django says "no changes detected", create the migration manually:

```python
# backend/apps/reservations/migrations/0010_booking_dates_index.py
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('reservations', '0009_booking_source_open_slug'),
    ]
    operations = [
        migrations.AddIndex(
            model_name='booking',
            index=models.Index(fields=['check_in', 'check_out'], name='booking_dates_idx'),
        ),
    ]
```

- [ ] **Step 2: Apply**

```bash
python manage.py migrate reservations
```

Expected: `Applying reservations.0010_booking_dates_index... OK`

- [ ] **Step 3: Commit**

```bash
git add backend/apps/reservations/migrations/0010_booking_dates_index.py
git commit -m "perf(reservations): index Booking.check_in + check_out for availability queries"
```

---

## Task 3: BerthCategory serializer + management CRUD API

**Files:**
- Modify: `backend/apps/berths/serializers.py`
- Modify: `backend/apps/berths/views.py`
- Modify: `backend/apps/berths/urls.py`

- [ ] **Step 1: Write failing test**

Create `backend/apps/berths/tests/test_berth_category.py`:

```python
import pytest
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.berths.models import BerthCategory
from apps.billing.models import ChargeableItem


def make_marina():
    return Marina.objects.create(name='Test Marina')


def make_tier(marina):
    return ChargeableItem.objects.create(
        marina=marina, name='Standard Night', category='berth',
        pricing_model='per_night', unit_price=40,
    )


def make_manager(marina):
    return User.objects.create_user(
        email='mgr@test.com', password='pass', role='manager', marina=marina,
    )


class BerthCategoryModelTest(TestCase):
    def setUp(self):
        self.marina = make_marina()

    def test_clean_rejects_bad_amenity_slug(self):
        from django.core.exceptions import ValidationError
        cat = BerthCategory(marina=self.marina, name='Bad', amenities=['power_9000'])
        with self.assertRaises(ValidationError):
            cat.clean()

    def test_clean_accepts_valid_slugs(self):
        cat = BerthCategory(marina=self.marina, name='Good', amenities=['power_30a', 'water'])
        cat.clean()  # should not raise

    def test_clean_accepts_empty_amenities(self):
        cat = BerthCategory(marina=self.marina, name='Empty', amenities=[])
        cat.clean()  # should not raise


class BerthCategoryAPITest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.tier = make_tier(self.marina)
        self.user = make_manager(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_create_category(self):
        res = self.client.post('/api/v1/berths/berth-categories/', {
            'name': 'Premium Slip',
            'description': '30A shore power included.',
            'mooring_type': 'finger',
            'amenities': ['power_30a', 'water'],
            'pricing_tier': self.tier.id,
            'sort_order': 1,
            'is_active': True,
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['name'], 'Premium Slip')

    def test_create_rejects_bad_amenity(self):
        res = self.client.post('/api/v1/berths/berth-categories/', {
            'name': 'Bad',
            'amenities': ['Wifi '],
            'pricing_tier': self.tier.id,
        }, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('amenities', res.data)

    def test_list_scoped_to_marina(self):
        other = make_marina()
        BerthCategory.objects.create(marina=other, name='Other Marina Cat')
        BerthCategory.objects.create(marina=self.marina, name='My Cat')
        res = self.client.get('/api/v1/berths/berth-categories/')
        self.assertEqual(res.status_code, 200)
        names = [c['name'] for c in res.data]
        self.assertIn('My Cat', names)
        self.assertNotIn('Other Marina Cat', names)
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend
python manage.py test apps.berths.tests.test_berth_category -v 2
```

Expected: `ERROR` — `BerthCategoryAPITest` will 404 (route not registered yet).

- [ ] **Step 3: Add serializer**

In `backend/apps/berths/serializers.py`, add at the bottom:

```python
from .models import BerthCategory, AMENITY_SLUGS
from rest_framework import serializers as drf_serializers


class BerthCategorySerializer(drf_serializers.ModelSerializer):
    class Meta:
        model = BerthCategory
        fields = ['id', 'name', 'description', 'mooring_type', 'amenities',
                  'pricing_tier', 'sort_order', 'is_active']

    def validate_amenities(self, value):
        bad = [s for s in value if s not in AMENITY_SLUGS]
        if bad:
            raise drf_serializers.ValidationError(
                f'Unknown amenity slug(s): {bad}. Allowed: {sorted(AMENITY_SLUGS)}'
            )
        return value
```

- [ ] **Step 4: Add ViewSet**

In `backend/apps/berths/views.py`, add at the bottom (after existing imports are present):

```python
from .models import BerthCategory
from .serializers import BerthCategorySerializer
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated


class BerthCategoryViewSet(viewsets.ModelViewSet):
    serializer_class = BerthCategorySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return BerthCategory.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)
```

- [ ] **Step 5: Register URL**

In `backend/apps/berths/urls.py`, import and register:

```python
from .views import BerthCategoryViewSet

# Add to the router (already exists):
router.register(r'berth-categories', BerthCategoryViewSet, basename='berth-category')
```

- [ ] **Step 6: Run tests — expect pass**

```bash
python manage.py test apps.berths.tests.test_berth_category -v 2
```

Expected: `OK` — all 5 tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/berths/serializers.py backend/apps/berths/views.py \
        backend/apps/berths/urls.py backend/apps/berths/tests/test_berth_category.py
git commit -m "feat(berths): BerthCategory CRUD API with amenity slug validation"
```

---

## Task 4: PublicBerthCategoriesView — GET /public/bookings/berth-categories/

**Files:**
- Modify: `backend/apps/portal/public_booking_views.py`
- Modify: `backend/apps/portal/public_urls.py`
- Modify: `backend/apps/portal/tests/test_public_booking.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/apps/portal/tests/test_public_booking.py`:

```python
from apps.berths.models import BerthCategory, Berth, Pier


class PublicBerthCategoriesViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Cat Marina', slug='cat-marina', booking_mode='auto_tetris')
        self.tier = ChargeableItem.objects.create(
            marina=self.marina, name='Night', category='berth',
            pricing_model='per_night', unit_price=50,
        )
        self.cat = BerthCategory.objects.create(
            marina=self.marina, name='Standard', amenities=['water'],
            pricing_tier=self.tier, is_active=True,
        )
        pier = Pier.objects.create(marina=self.marina, code='A')
        self.berth = Berth.objects.create(
            marina=self.marina, pier=pier, code='A1',
            length_m=12, max_beam_m=4, max_draft_m=2,
            status='available', berth_class='standard',
            pricing_tier=self.tier, category=self.cat,
        )
        self.client = APIClient()
        self.url = '/api/v1/public/bookings/berth-categories/'

    def _get(self, check_in='2026-08-01', check_out='2026-08-05', loa='10', beam='3', draft='1.5'):
        qs = f'check_in={check_in}&check_out={check_out}&boat_loa={loa}&boat_beam={beam}&boat_draft={draft}'
        return self.client.get(
            f'{self.url}?{qs}',
            HTTP_X_MARINA_SLUG='cat-marina',
        )

    def test_returns_available_categories(self):
        res = self._get()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]['name'], 'Standard')
        self.assertEqual(res.data[0]['available_count'], 1)
        self.assertEqual(res.data[0]['price_per_night'], '50.00')

    def test_excludes_category_without_pricing_tier(self):
        BerthCategory.objects.create(
            marina=self.marina, name='No Tier', is_active=True,
            pricing_tier=None,
        )
        res = self._get()
        names = [c['name'] for c in res.data]
        self.assertNotIn('No Tier', names)

    def test_excludes_category_when_boat_too_large(self):
        res = self._get(loa='20')  # berth max is 12m
        self.assertEqual(res.data, [])

    def test_requires_marina_slug(self):
        res = self.client.get(self.url + '?check_in=2026-08-01&check_out=2026-08-05')
        self.assertEqual(res.status_code, 404)
```

- [ ] **Step 2: Run — expect failure**

```bash
python manage.py test apps.portal.tests.test_public_booking.PublicBerthCategoriesViewTest -v 2
```

Expected: `ERROR` — URL not found.

- [ ] **Step 3: Implement the view**

In `backend/apps/portal/public_booking_views.py`, add after the existing imports:

```python
from apps.berths.models import BerthCategory, Berth
from django.db.models import Count, Q, Subquery, OuterRef, Exists
```

Then add the view class:

```python
class PublicBerthCategoriesView(APIView):
    """GET /api/v1/public/bookings/berth-categories/"""
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        if request.tenant is None:
            return Response({'detail': 'Marina not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            ci, co, boat_loa, boat_beam, boat_draft = _parse_availability_params(request)
        except KeyError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        # Berths occupied during the requested window
        conflicting_bookings = Booking.objects.filter(
            berth=OuterRef('pk'),
            status__in=['pending_payment', 'confirmed', 'checked_in'],
            check_in__lt=co,
            check_out__gt=ci,
        )

        # Available berths: standard class, fits boat, no conflict, has a category
        dim_filter = Q()
        if boat_loa:
            dim_filter &= Q(length_m__gte=float(boat_loa))
        if boat_beam:
            dim_filter &= Q(max_beam_m__gte=float(boat_beam))
        if boat_draft:
            dim_filter &= Q(max_draft_m__gte=float(boat_draft))

        available_berths = Berth.objects.filter(
            marina=request.tenant,
            berth_class='standard',
            status__in=['available', 'reserved'],
            category__isnull=False,
        ).filter(dim_filter).exclude(Exists(conflicting_bookings))

        # Group by category — only active categories with a pricing tier
        categories = BerthCategory.objects.filter(
            marina=request.tenant,
            is_active=True,
            pricing_tier__isnull=False,
        ).prefetch_related('pricing_tier')

        result = []
        for cat in categories:
            count = available_berths.filter(category=cat).count()
            if count == 0:
                continue
            result.append({
                'id': cat.id,
                'name': cat.name,
                'description': cat.description,
                'mooring_type': cat.mooring_type,
                'amenities': cat.amenities,
                'price_per_night': str(cat.pricing_tier.unit_price),
                'available_count': count,
            })

        return Response(result)
```

- [ ] **Step 4: Register the URL**

In `backend/apps/portal/public_urls.py`:

```python
from apps.portal.public_booking_views import (
    PublicBookingCreateView,
    PublicAvailableBerthsView,
    PublicAvailabilityAlternativesView,
    PublicEngineRequestView,
    PublicBerthCategoriesView,   # add this
)

urlpatterns = [
    path('marina/',                             MarinaPublicView.as_view(),                    name='public-marina'),
    path('bookings/',                           PublicBookingCreateView.as_view(),             name='public-booking-create'),
    path('bookings/available-berths/',          PublicAvailableBerthsView.as_view(),           name='public-available-berths'),
    path('bookings/availability-alternatives/', PublicAvailabilityAlternativesView.as_view(),  name='public-availability-alternatives'),
    path('bookings/berth-categories/',          PublicBerthCategoriesView.as_view(),           name='public-berth-categories'),  # add
    path('bookings/engine-request/',            PublicEngineRequestView.as_view(),             name='public-engine-request'),
]
```

- [ ] **Step 5: Run tests — expect pass**

```bash
python manage.py test apps.portal.tests.test_public_booking.PublicBerthCategoriesViewTest -v 2
```

Expected: `OK` — all 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/portal/public_booking_views.py \
        backend/apps/portal/public_urls.py \
        backend/apps/portal/tests/test_public_booking.py
git commit -m "feat(portal): GET /public/bookings/berth-categories/ endpoint"
```

---

## Task 5: Stripe PaymentIntent helper + PublicBerthIntentView

**Files:**
- Modify: `backend/apps/billing/stripe_service.py`
- Modify: `backend/apps/portal/public_booking_views.py`
- Modify: `backend/apps/portal/public_urls.py`
- Modify: `backend/apps/portal/tests/test_public_booking.py`

- [ ] **Step 1: Write failing test**

Append to `backend/apps/portal/tests/test_public_booking.py`:

```python
from unittest.mock import patch, MagicMock


class PublicBerthIntentViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='Intent Marina', slug='intent-marina',
            booking_mode='auto_tetris', stripe_account_id='acct_test123',
        )
        self.tier = ChargeableItem.objects.create(
            marina=self.marina, name='Night', category='berth',
            pricing_model='per_night', unit_price=55,
        )
        self.cat = BerthCategory.objects.create(
            marina=self.marina, name='Premium', amenities=['power_30a'],
            pricing_tier=self.tier, is_active=True,
        )
        self.client = APIClient()
        self.url = '/api/v1/public/bookings/intent/'

    @patch('apps.portal.public_booking_views.billing_service.create_payment_intent',
           return_value='pi_test_secret_xyz')
    def test_returns_client_secret(self, mock_pi):
        res = self.client.post(self.url, {
            'berth_category_id': self.cat.id,
            'check_in': '2026-09-01',
            'check_out': '2026-09-05',
        }, format='json', HTTP_X_MARINA_SLUG='intent-marina')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['client_secret'], 'pi_test_secret_xyz')
        self.assertEqual(res.data['nights'], 4)
        self.assertEqual(res.data['price_per_night'], '55.00')
        self.assertEqual(res.data['total'], '220.00')

    def test_rejects_inactive_category(self):
        self.cat.is_active = False
        self.cat.save()
        res = self.client.post(self.url, {
            'berth_category_id': self.cat.id,
            'check_in': '2026-09-01',
            'check_out': '2026-09-05',
        }, format='json', HTTP_X_MARINA_SLUG='intent-marina')
        self.assertEqual(res.status_code, 400)

    def test_rejects_category_without_pricing_tier(self):
        cat2 = BerthCategory.objects.create(
            marina=self.marina, name='No Tier', pricing_tier=None, is_active=True,
        )
        res = self.client.post(self.url, {
            'berth_category_id': cat2.id,
            'check_in': '2026-09-01',
            'check_out': '2026-09-05',
        }, format='json', HTTP_X_MARINA_SLUG='intent-marina')
        self.assertEqual(res.status_code, 400)
```

- [ ] **Step 2: Run — expect failure**

```bash
python manage.py test apps.portal.tests.test_public_booking.PublicBerthIntentViewTest -v 2
```

Expected: URL not found errors.

- [ ] **Step 3: Add create_payment_intent to stripe_service.py**

In `backend/apps/billing/stripe_service.py`, add:

```python
def create_payment_intent(marina, amount_cents, currency, metadata=None):
    """Creates a PaymentIntent on the marina's Connect account. Returns client_secret."""
    intent = stripe.PaymentIntent.create(
        amount=amount_cents,
        currency=currency.lower(),
        payment_method_types=['card'],
        metadata=metadata or {},
        stripe_account=marina.stripe_account_id or None,
    )
    return intent.client_secret
```

- [ ] **Step 4: Add PublicBerthIntentView**

In `backend/apps/portal/public_booking_views.py`, add:

```python
class PublicBerthIntentSerializer(serializers.Serializer):
    berth_category_id = serializers.IntegerField()
    check_in          = serializers.DateField()
    check_out         = serializers.DateField()

    def validate(self, data):
        if data['check_in'] >= data['check_out']:
            raise serializers.ValidationError({'check_out': 'check_out must be after check_in.'})
        if data['check_in'] < datetime.date.today():
            raise serializers.ValidationError({'check_in': 'check_in cannot be in the past.'})
        return data


class PublicBerthIntentView(APIView):
    """POST /api/v1/public/bookings/intent/ — creates Stripe PaymentIntent for a category."""
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        if request.tenant is None:
            return Response({'detail': 'Marina not found.'}, status=status.HTTP_404_NOT_FOUND)

        ser = PublicBerthIntentSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        d = ser.validated_data
        marina = request.tenant

        try:
            from apps.berths.models import BerthCategory
            cat = BerthCategory.objects.select_related('pricing_tier').get(
                pk=d['berth_category_id'],
                marina=marina,
                is_active=True,
            )
        except BerthCategory.DoesNotExist:
            return Response({'detail': 'Berth category not found or inactive.'}, status=status.HTTP_400_BAD_REQUEST)

        if cat.pricing_tier is None:
            return Response({'detail': 'This category has no price configured.'}, status=status.HTTP_400_BAD_REQUEST)

        nights = (d['check_out'] - d['check_in']).days
        price_per_night = cat.pricing_tier.unit_price
        total = price_per_night * nights
        amount_cents = int(round(float(total) * 100))

        try:
            client_secret = billing_service.create_payment_intent(
                marina=marina,
                amount_cents=amount_cents,
                currency=marina.currency,
                metadata={
                    'berth_category_id': str(cat.id),
                    'check_in': str(d['check_in']),
                    'check_out': str(d['check_out']),
                    'marina_id': str(marina.id),
                },
            )
        except Exception:
            logger.exception('PublicBerthIntentView: Stripe error')
            return Response({'detail': 'Payment provider error.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        return Response({
            'client_secret': client_secret,
            'nights': nights,
            'price_per_night': str(price_per_night),
            'total': str(total),
        })
```

- [ ] **Step 5: Register URL**

In `backend/apps/portal/public_urls.py`, add:

```python
from apps.portal.public_booking_views import (
    PublicBookingCreateView, PublicAvailableBerthsView,
    PublicAvailabilityAlternativesView, PublicEngineRequestView,
    PublicBerthCategoriesView, PublicBerthIntentView,   # add
)

urlpatterns = [
    # ... existing ...
    path('bookings/berth-categories/', PublicBerthCategoriesView.as_view(), name='public-berth-categories'),
    path('bookings/intent/',           PublicBerthIntentView.as_view(),     name='public-berth-intent'),  # add
    path('bookings/engine-request/',   PublicEngineRequestView.as_view(),   name='public-engine-request'),
]
```

- [ ] **Step 6: Run tests — expect pass**

```bash
python manage.py test apps.portal.tests.test_public_booking.PublicBerthIntentViewTest -v 2
```

Expected: `OK` — all 3 tests pass.

- [ ] **Step 7: Modify PublicEngineRequestView to accept berth_category_id**

In `backend/apps/portal/public_booking_views.py`, update `PublicEngineRequestSerializer`:

```python
class PublicEngineRequestSerializer(serializers.Serializer):
    check_in          = serializers.DateField()
    check_out         = serializers.DateField()
    guest_name        = serializers.CharField(max_length=200)
    guest_email       = serializers.EmailField()
    guest_phone       = serializers.CharField(max_length=30, required=False, allow_blank=True)
    vessel_name       = serializers.CharField(max_length=200, required=False, allow_blank=True)
    eta               = serializers.TimeField(required=False, allow_null=True)
    boat_loa          = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, allow_null=True)
    boat_beam         = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    boat_draft        = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    berth_category_id = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, data):
        if data['check_in'] >= data['check_out']:
            raise serializers.ValidationError({'check_out': 'check_out must be after check_in.'})
        if data['check_in'] < datetime.date.today():
            raise serializers.ValidationError({'check_in': 'check_in cannot be in the past.'})
        return data
```

In `PublicEngineRequestView.post()`, after resolving marina and before calling `run_tetris`, add category constraint:

```python
        category_id = d.get('berth_category_id')
        category_filter = {}
        if category_id:
            try:
                from apps.berths.models import BerthCategory
                cat = BerthCategory.objects.get(pk=category_id, marina=marina, is_active=True)
                category_filter['category'] = cat
            except BerthCategory.DoesNotExist:
                return Response({'detail': 'Berth category not found.'}, status=status.HTTP_400_BAD_REQUEST)
```

Then pass `category_filter` into `run_tetris` — check `booking_engine.py` for whether it supports a `berth_filter` kwarg; if not, add filtering of the candidate berths before tetris runs. For now, store `category` on the booking after creation:

```python
                if category_filter:
                    booking.notes = f"Category: {category_filter['category'].name}"
                    booking.save(update_fields=['notes'])
```

*(Full berth-constrained tetris is a future enhancement — the harbor master still assigns the physical slip. The category is stored as a note for reference.)*

- [ ] **Step 8: Commit**

```bash
git add backend/apps/billing/stripe_service.py \
        backend/apps/portal/public_booking_views.py \
        backend/apps/portal/public_urls.py \
        backend/apps/portal/tests/test_public_booking.py
git commit -m "feat(portal): POST /public/bookings/intent/ + berth_category_id on engine-request"
```

---

## Task 6: Management app cleanup

**Files:**
- Delete: `frontend/src/screens/BoaterPortal.jsx`
- Delete: `frontend/src/components/portal/PaymentModal.jsx`
- Modify: `frontend/src/styles/app.css`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/screens/Login.jsx`

- [ ] **Step 1: Delete the two dead files**

```bash
git rm frontend/src/screens/BoaterPortal.jsx
git rm frontend/src/components/portal/PaymentModal.jsx
```

- [ ] **Step 2: Remove /portal route from App.jsx**

In `frontend/src/App.jsx`, remove line:
```jsx
import BoaterPortal from './screens/BoaterPortal.jsx';
```

Remove the route:
```jsx
<Route path="/portal" element={<ProtectedRoute element={<BoaterPortal />} allowedRoles={['boater']} />} />
```

- [ ] **Step 3: Redirect boaters in Login.jsx**

In `frontend/src/screens/Login.jsx`, find the `handleSubmit` function. Replace:

```jsx
      signIn(user);
      navigate(ROLE_HOME[user.role] ?? '/', { replace: true });
```

With:

```jsx
      signIn(user);
      if (user.role === 'boater') {
        window.location.href = import.meta.env.VITE_PORTAL_URL || 'https://booking.docksbase.com';
        return;
      }
      navigate(ROLE_HOME[user.role] ?? '/', { replace: true });
```

- [ ] **Step 4: Strip portal CSS from app.css**

Open `frontend/src/styles/app.css`. Find the comment `/* ── Boater Portal ──` (around line 442). Delete from that comment through to the end of the portal CSS block — this includes:
- `@keyframes fadeSlideUp`
- `@keyframes logoPulse`
- `.portal-shell`, `.portal-header`, `.portal-header-left`, `.portal-logo-wrap`, `.portal-logo-ring`
- `.portal-marina-name`, `.portal-boater-name`, `.portal-signout`
- `.portal-tabs`, `.portal-tabs .tab`, `.portal-content`, `.portal-tab-content`, `.portal-list`
- All `.portal-invoice-card`, `.portal-booking-card`, `.portal-checkin-card` dark variants
- `.portal-input` and its variants

Stop before any non-portal CSS. Keep `login-*`, `abtn`, `abtn-gold`, `@keyframes spin`.

Verify by running the management frontend dev server and checking that Login, Overview, Settings pages still render correctly.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/styles/app.css frontend/src/App.jsx frontend/src/screens/Login.jsx
git commit -m "chore(frontend): remove BoaterPortal screen, strip rogue portal CSS, redirect boaters to portal URL"
```

---

## Task 7: Service Catalog — Berth Categories tab

**Files:**
- Create: `frontend/src/hooks/useBerthCategories.js`
- Modify: `frontend/src/screens/ServiceCatalogScreen.jsx`

- [ ] **Step 1: Create useBerthCategories hook**

Create `frontend/src/hooks/useBerthCategories.js`:

```js
import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useBerthCategories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/berths/berth-categories/');
      setCategories(data.results ?? data);
    } catch (e) { setError(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const save = useCallback(async (payload, id = null) => {
    if (id) {
      const { data } = await api.patch(`/berths/berth-categories/${id}/`, payload);
      setCategories(prev => prev.map(c => c.id === id ? data : c));
      return data;
    }
    const { data } = await api.post('/berths/berth-categories/', payload);
    setCategories(prev => [...prev, data]);
    return data;
  }, []);

  const remove = useCallback(async (id) => {
    await api.delete(`/berths/berth-categories/${id}/`);
    setCategories(prev => prev.filter(c => c.id !== id));
  }, []);

  return { categories, loading, error, save, remove, refresh: fetch };
}
```

- [ ] **Step 2: Add BerthCategories section to ServiceCatalogScreen.jsx**

In `frontend/src/screens/ServiceCatalogScreen.jsx`, add a new tab to the `TABS` array:

```jsx
const TABS = [
  { value: 'berth-categories', label: 'Berth Categories', addLabel: 'Add Category' },
  { value: 'berth',   label: 'Berth Rates',  addLabel: 'Add Berth Rate'  },
  { value: 'utility', label: 'Utilities',     addLabel: 'Add Utility'     },
  { value: 'service', label: 'Services',      addLabel: 'Add Service'     },
  { value: 'retail',  label: 'Retail & Fuel', addLabel: 'Add Retail Item' },
];
```

Add import and state at the top of the component:

```jsx
import useBerthCategories from '../hooks/useBerthCategories.js';

// inside the component:
const { categories, loading: catLoading, save: saveCat, remove: removeCat } = useBerthCategories();
const [catPanel, setCatPanel] = useState(false);
const [editCat, setEditCat]   = useState(null);
```

Add the panel component (define outside the screen component):

```jsx
const AMENITY_LABELS = {
  power_30a: '⚡ 30A Power', power_50a: '⚡ 50A Power',
  water: '💧 Water', wifi: '📶 WiFi',
  fuel_nearby: '⛽ Fuel Nearby', pump_out: '🔄 Pump-out',
};
const AMENITY_SLUGS = Object.keys(AMENITY_LABELS);
const MOORING_OPTIONS = [
  { value: 'finger',       label: 'Finger Pontoon' },
  { value: 'alongside',    label: 'Alongside' },
  { value: 'stern_to',     label: 'Stern-to' },
  { value: 'mooring_ball', label: 'Mooring Ball' },
];

function BerthCategoryPanel({ item, berthRates, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({
    name: item?.name ?? '',
    description: item?.description ?? '',
    mooring_type: item?.mooring_type ?? 'finger',
    amenities: item?.amenities ?? [],
    pricing_tier: item?.pricing_tier ?? '',
    sort_order: item?.sort_order ?? 0,
    is_active: item?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleAmenity = (slug) => setForm(f => ({
    ...f,
    amenities: f.amenities.includes(slug)
      ? f.amenities.filter(a => a !== slug)
      : [...f.amenities, slug],
  }));

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      await onSave(form, item?.id);
      onClose();
    } catch (e) {
      setErr(e.response?.data?.amenities?.[0] || e.response?.data?.detail || 'Save failed.');
    } finally { setSaving(false); }
  }

  return (
    <div className="drawer">
      <div className="drawer-header">
        <span>{item ? 'Edit Category' : 'New Berth Category'}</span>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
      </div>
      <form onSubmit={handleSave} className="drawer-body">
        <div className="form-group">
          <label className="form-label">Name *</label>
          <input className="form-input" required value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Premium Slip" />
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea className="form-input" maxLength={120} rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Short description shown to boaters" />
        </div>
        <div className="form-group">
          <label className="form-label">Mooring type</label>
          <select className="form-input" value={form.mooring_type} onChange={e => set('mooring_type', e.target.value)}>
            {MOORING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Amenities</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {AMENITY_SLUGS.map(slug => (
              <label key={slug} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.amenities.includes(slug)} onChange={() => toggleAmenity(slug)} />
                {AMENITY_LABELS[slug]}
              </label>
            ))}
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Pricing tier *</label>
          <select className="form-input" required value={form.pricing_tier} onChange={e => set('pricing_tier', e.target.value ? Number(e.target.value) : '')}>
            <option value="">— select a berth rate —</option>
            {berthRates.map(r => <option key={r.id} value={r.id}>{r.name} (€{r.unit_price}/night)</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Sort order</label>
            <input type="number" className="form-input" value={form.sort_order} onChange={e => set('sort_order', Number(e.target.value))} />
          </div>
          <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />
              Active
            </label>
          </div>
        </div>
        {err && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8 }}>
          {item && <button type="button" className="btn btn-danger btn-sm" onClick={() => { onDelete(item.id); onClose(); }}>Delete</button>}
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
```

In the render, add the berth-categories tab content alongside the existing tab renders:

```jsx
{tab === 'berth-categories' && (
  <>
    {catPanel && (
      <BerthCategoryPanel
        item={editCat}
        berthRates={items}  {/* reuse berth ChargeableItems loaded when on berth tab */}
        onSave={saveCat}
        onDelete={removeCat}
        onClose={() => { setCatPanel(false); setEditCat(null); }}
      />
    )}
    <table className="tbl">
      <thead>
        <tr>
          <th>Name</th><th>Mooring</th><th>Amenities</th><th>Tier</th><th>Active</th><th></th>
        </tr>
      </thead>
      <tbody>
        {categories.map(c => (
          <tr key={c.id}>
            <td>{c.name}</td>
            <td style={{ textTransform: 'capitalize' }}>{c.mooring_type.replace('_', '-')}</td>
            <td>
              {c.amenities.map(a => (
                <span key={a} className="badge badge-info" style={{ marginRight: 4 }}>{AMENITY_LABELS[a] ?? a}</span>
              ))}
            </td>
            <td>{c.pricing_tier_name ?? '—'}</td>
            <td>{c.is_active ? '✓' : '—'}</td>
            <td><button className="btn btn-ghost btn-sm" onClick={() => { setEditCat(c); setCatPanel(true); }}>Edit</button></td>
          </tr>
        ))}
      </tbody>
    </table>
    {catPanel === false && tab === 'berth-categories' && (
      // The "+ Add Category" button in the header already sets catPanel=true via openCreate
      // Make sure openCreate for this tab calls setCatPanel(true) and setEditCat(null)
      null
    )}
  </>
)}
```

Wire the "Add" button: in `openCreate`, add a branch for the berth-categories tab:

```jsx
function openCreate() {
  if (tab === 'berth-categories') { setEditCat(null); setCatPanel(true); return; }
  setEditItem(null);
  setDrawerOpen(true);
}
```

Also, when switching to 'berth-categories', we need the berth rates list for the pricing tier dropdown. Add a `useServiceCatalog('berth')` call (separate from the tab-driven one) to always have berth rates available:

```jsx
const { items: berthRates } = useServiceCatalog('berth');
```

- [ ] **Step 3: Verify in browser**

Start the management frontend dev server:
```bash
cd frontend && npm run dev
```
Navigate to Settings → Service Catalog → "Berth Categories" tab. Verify: table renders (empty), "Add Category" opens panel, form saves via API (check network tab), amenity validation error shows on bad input.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useBerthCategories.js frontend/src/screens/ServiceCatalogScreen.jsx
git commit -m "feat(frontend): Berth Categories tab in Service Catalog"
```

---

## Task 8: Portal — design tokens CSS

**Files:**
- Create: `portal/src/styles/portal.css`
- Modify: `portal/src/main.jsx`

- [ ] **Step 1: Create portal.css**

Create `portal/src/styles/portal.css`:

```css
/* ── Tokens ─────────────────────────────────────────────────────────── */
:root {
  --navy:       #0c1f3d;
  --navy2:      #162d52;
  --navy3:      #1e3d6e;
  --gold:       #b8965a;
  --gold2:      #d4b07a;
  --cream:      #f5f0e6;
  --muted:      rgba(245,240,230,0.45);
  --border:     rgba(255,255,255,0.08);
  --font:       'IBM Plex Sans', system-ui, sans-serif;
  --font-serif: 'Cormorant Garamond', Georgia, serif;
  --font-brand: 'Jost', system-ui, sans-serif;
}

/* ── Reset ───────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font); background: var(--navy); color: var(--cream); min-height: 100vh; }
a { color: inherit; text-decoration: none; }
button { cursor: pointer; border: none; background: none; font-family: inherit; color: inherit; }
input, select, textarea { font-family: inherit; }

/* ── Loading / error states ──────────────────────────────────────────── */
.p-center {
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  background: var(--navy);
}

/* ── Nav ─────────────────────────────────────────────────────────────── */
.p-nav {
  background: var(--navy);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 12px;
  padding: 0 24px; height: 56px;
}
.p-nav-brand {
  font-family: var(--font-brand);
  font-size: 11px; font-weight: 700; letter-spacing: 2.5px; text-transform: uppercase;
  color: var(--cream);
}
.p-nav-marina {
  font-size: 13px; color: var(--muted);
}

/* ── Page shell ──────────────────────────────────────────────────────── */
.p-shell {
  max-width: 860px; margin: 0 auto; padding: 48px 24px 80px;
}
.p-eyebrow {
  font-family: var(--font-brand); font-size: 10px; letter-spacing: 3px;
  text-transform: uppercase; color: var(--gold); margin-bottom: 10px;
}
.p-title {
  font-family: var(--font-serif); font-size: 40px; font-weight: 600;
  color: var(--cream); line-height: 1.1; margin-bottom: 8px;
}
.p-sub { font-size: 14px; color: var(--muted); margin-bottom: 36px; }

/* ── Form inputs ─────────────────────────────────────────────────────── */
.p-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 16px; }
.p-label {
  font-size: 11px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase;
  color: var(--muted);
}
.p-input {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 5px; padding: 9px 12px;
  font-size: 14px; color: var(--cream); outline: none;
  transition: border-color 0.15s;
}
.p-input::placeholder { color: rgba(245,240,230,0.25); }
.p-input:focus { border-color: rgba(184,150,90,0.5); }
.p-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.p-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }

/* ── Buttons ─────────────────────────────────────────────────────────── */
.p-btn-gold {
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--gold); color: #fff;
  font-family: var(--font-brand); font-size: 11px; font-weight: 700; letter-spacing: 0.8px;
  text-transform: uppercase; padding: 12px 24px; border-radius: 4px;
  transition: background 0.15s; cursor: pointer; border: none;
}
.p-btn-gold:hover { background: var(--gold2); }
.p-btn-gold:disabled { background: rgba(184,150,90,0.35); cursor: not-allowed; }
.p-btn-outline {
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid rgba(255,255,255,0.2); color: var(--muted);
  font-size: 12px; font-weight: 600; padding: 10px 18px; border-radius: 4px;
  transition: border-color 0.15s, color 0.15s;
}
.p-btn-outline:hover { border-color: rgba(255,255,255,0.4); color: var(--cream); }

/* ── Category cards ──────────────────────────────────────────────────── */
.p-options-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px;
  margin-bottom: 32px;
}
.p-cat-card {
  background: var(--navy2); border: 1px solid var(--border);
  border-radius: 10px; padding: 24px;
  display: flex; flex-direction: column; gap: 10px;
  transition: border-color 0.15s;
}
.p-cat-card:hover { border-color: rgba(184,150,90,0.3); }
.p-cat-name { font-family: var(--font-serif); font-size: 22px; font-weight: 600; color: var(--cream); }
.p-cat-mooring {
  display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 1px;
  text-transform: uppercase; color: var(--gold);
  border: 1px solid rgba(184,150,90,0.3); border-radius: 3px; padding: 2px 7px;
  width: fit-content;
}
.p-cat-desc { font-size: 13px; color: var(--muted); line-height: 1.5; flex: 1; }
.p-amenity-pills { display: flex; flex-wrap: wrap; gap: 6px; }
.p-amenity-pill {
  font-size: 11px; color: var(--cream);
  background: rgba(255,255,255,0.07); border: 1px solid var(--border);
  border-radius: 20px; padding: 3px 9px;
}
.p-cat-price { font-family: var(--font-serif); font-size: 26px; color: var(--gold); }
.p-cat-price span { font-family: var(--font); font-size: 12px; color: var(--muted); }
.p-cat-avail { font-size: 11px; color: var(--muted); }

/* ── Summary bar ─────────────────────────────────────────────────────── */
.p-summary {
  background: var(--navy2); border: 1px solid var(--border); border-radius: 8px;
  padding: 16px 20px; margin-bottom: 28px;
  display: flex; align-items: center; gap: 24px; flex-wrap: wrap;
}
.p-summary-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin-bottom: 2px; }
.p-summary-val { font-size: 14px; color: var(--cream); font-weight: 500; }
.p-summary-total { font-family: var(--font-serif); font-size: 22px; color: var(--gold); margin-left: auto; }

/* ── Error / info banners ─────────────────────────────────────────────── */
.p-error { font-size: 13px; color: #f87171; margin-bottom: 12px; }
.p-section-title {
  font-family: var(--font-brand); font-size: 10px; letter-spacing: 2px;
  text-transform: uppercase; color: var(--gold); margin-bottom: 14px;
}

/* ── Confirmation box ─────────────────────────────────────────────────── */
.p-confirmed-box {
  background: var(--navy2); border: 1px solid rgba(184,150,90,0.2);
  border-radius: 12px; padding: 40px 32px; text-align: center; margin-bottom: 28px;
}
.p-confirmed-check {
  width: 52px; height: 52px; border-radius: 50%;
  background: rgba(184,150,90,0.15); border: 1.5px solid var(--gold);
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; color: var(--gold); margin: 0 auto 16px;
}
.p-confirmed-id {
  font-family: var(--font-brand); font-size: 22px; font-weight: 700;
  letter-spacing: 3px; color: var(--cream); margin-bottom: 4px;
}

@media (max-width: 600px) {
  .p-grid-2, .p-grid-3 { grid-template-columns: 1fr; }
  .p-title { font-size: 30px; }
}
```

- [ ] **Step 2: Import in main.jsx**

In `portal/src/main.jsx`, add before the existing CSS import (or after — order matters only if there's a conflict):

```jsx
import './styles/portal.css'
```

Remove any existing inline `body { background: #f4f6f8 }` or similar light-background global styles if present.

- [ ] **Step 3: Commit**

```bash
git add portal/src/styles/portal.css portal/src/main.jsx
git commit -m "feat(portal): dark navy/gold design token CSS"
```

---

## Task 9: Portal — SearchScreen redesign

**Files:**
- Modify: `portal/src/screens/SearchScreen.jsx`

- [ ] **Step 1: Replace SearchScreen with dark themed version**

Replace the entire contents of `portal/src/screens/SearchScreen.jsx`:

```jsx
import { useState } from 'react';
import api from '../api';

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function SearchScreen({ state, navigate, marina }) {
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    checkIn:   state.checkIn   || '',
    checkOut:  state.checkOut  || '',
    boatLoa:   state.boatLoa   || '',
    boatBeam:  state.boatBeam  || '',
    boatDraft: state.boatDraft || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const nights =
    form.checkIn && form.checkOut
      ? Math.round((new Date(form.checkOut) - new Date(form.checkIn)) / 86400000)
      : 0;

  const handleSubmit = async e => {
    e.preventDefault();
    setBusy(true); setError('');
    const params = new URLSearchParams({
      check_in:  form.checkIn,
      check_out: form.checkOut,
    });
    if (form.boatLoa)   params.set('boat_loa',   form.boatLoa);
    if (form.boatBeam)  params.set('boat_beam',  form.boatBeam);
    if (form.boatDraft) params.set('boat_draft', form.boatDraft);

    try {
      // Try berth-categories first (marina with configured tiers)
      const { data: cats } = await api.get(`/public/bookings/berth-categories/?${params}`);
      if (cats.length > 0) {
        navigate('options', { ...form, categories: cats });
        return;
      }
      // Fallback: plain availability check
      const { data: berths } = await api.get(`/public/bookings/available-berths/?${params}`);
      if (berths.length > 0) {
        const pricePerNight = parseFloat(berths[0].pricing_tier_unit_price || 0);
        navigate('quote', { ...form, quotedPrice: pricePerNight, quotedTotal: pricePerNight * nights, selectedCategory: null });
        return;
      }
      const { data: alts } = await api.get(`/public/bookings/availability-alternatives/?${params}`);
      if (alts.length > 0) {
        navigate('alternatives', { ...form, alternatives: alts });
        return;
      }
      setError('No availability for those dates or dimensions. Please contact the marina directly.');
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <>
      <nav className="p-nav">
        <span className="p-nav-brand">DocksBase</span>
        {marina && <span className="p-nav-marina">— {marina.name}</span>}
      </nav>
      <div className="p-shell">
        <div className="p-eyebrow">Berth booking</div>
        <h1 className="p-title">Find a berth.</h1>
        <p className="p-sub">Enter your dates and vessel dimensions to check availability.</p>

        {state.errorBanner && (
          <div className="p-error" style={{ marginBottom: 20 }}>{state.errorBanner}</div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="p-grid-2" style={{ marginBottom: 0 }}>
            <div className="p-field">
              <label className="p-label">Arrival date</label>
              <input className="p-input" type="date" required min={today}
                value={form.checkIn} onChange={e => set('checkIn', e.target.value)} />
            </div>
            <div className="p-field">
              <label className="p-label">Departure date</label>
              <input className="p-input" type="date" required min={form.checkIn || today}
                value={form.checkOut} onChange={e => set('checkOut', e.target.value)} />
            </div>
          </div>
          {nights > 0 && (
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>
              {nights} night{nights !== 1 ? 's' : ''} · {formatDate(form.checkIn)} → {formatDate(form.checkOut)}
            </p>
          )}

          <div className="p-section-title" style={{ marginTop: 8 }}>Vessel dimensions</div>
          <div className="p-grid-3">
            <div className="p-field">
              <label className="p-label">LOA (m)</label>
              <input className="p-input" type="number" step="0.1" min="1" placeholder="12.5"
                value={form.boatLoa} onChange={e => set('boatLoa', e.target.value)} />
            </div>
            <div className="p-field">
              <label className="p-label">Beam (m)</label>
              <input className="p-input" type="number" step="0.1" min="0" placeholder="4.2"
                value={form.boatBeam} onChange={e => set('boatBeam', e.target.value)} />
            </div>
            <div className="p-field">
              <label className="p-label">Draft (m)</label>
              <input className="p-input" type="number" step="0.1" min="0" placeholder="1.8"
                value={form.boatDraft} onChange={e => set('boatDraft', e.target.value)} />
            </div>
          </div>

          {error && <p className="p-error">{error}</p>}

          <button type="submit" className="p-btn-gold" disabled={busy} style={{ marginTop: 8, width: '100%' }}>
            {busy ? 'Checking…' : 'Search'}
          </button>
        </form>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify visually**

Start the portal dev server:
```bash
cd portal && npm run dev
```
Visit `http://localhost:5176/test-marina`. Should see dark navy page with serif heading, gold Search button, cream inputs.

- [ ] **Step 3: Commit**

```bash
git add portal/src/screens/SearchScreen.jsx
git commit -m "feat(portal): SearchScreen dark navy/gold redesign"
```

---

## Task 10: Portal — OptionsScreen (new)

**Files:**
- Create: `portal/src/screens/OptionsScreen.jsx`

- [ ] **Step 1: Create OptionsScreen.jsx**

```jsx
const AMENITY_LABELS = {
  power_30a: '⚡ 30A Power',
  power_50a: '⚡ 50A Power',
  water:     '💧 Water',
  wifi:      '📶 WiFi',
  fuel_nearby: '⛽ Fuel Nearby',
  pump_out:  '🔄 Pump-out',
};

const MOORING_LABELS = {
  finger:       'Finger Pontoon',
  alongside:    'Alongside',
  stern_to:     'Stern-to',
  mooring_ball: 'Mooring Ball',
};

export default function OptionsScreen({ state, navigate }) {
  const nights = Math.round(
    (new Date(state.checkOut) - new Date(state.checkIn)) / 86400000
  );

  function handleSelect(cat) {
    navigate('quote', {
      ...state,
      selectedCategory: cat,
      quotedPrice: parseFloat(cat.price_per_night),
      quotedTotal: parseFloat(cat.price_per_night) * nights,
    });
  }

  return (
    <>
      <nav className="p-nav">
        <span className="p-nav-brand">DocksBase</span>
      </nav>
      <div className="p-shell">
        <button className="p-btn-outline" onClick={() => navigate('search')} style={{ marginBottom: 28 }}>
          ← Change search
        </button>

        <div className="p-eyebrow">Available options</div>
        <h1 className="p-title">Choose your berth.</h1>
        <p className="p-sub">
          {state.checkIn} → {state.checkOut} · {nights} night{nights !== 1 ? 's' : ''} ·
          Vessel {state.boatLoa}m
        </p>

        <div className="p-options-grid">
          {state.categories.map(cat => (
            <div key={cat.id} className="p-cat-card">
              <div className="p-cat-name">{cat.name}</div>
              <div className="p-cat-mooring">{MOORING_LABELS[cat.mooring_type] ?? cat.mooring_type}</div>
              {cat.description && <p className="p-cat-desc">{cat.description}</p>}
              {cat.amenities.length > 0 && (
                <div className="p-amenity-pills">
                  {cat.amenities.map(a => (
                    <span key={a} className="p-amenity-pill">{AMENITY_LABELS[a] ?? a}</span>
                  ))}
                </div>
              )}
              <div className="p-cat-price">
                €{cat.price_per_night}<span>/night</span>
              </div>
              {nights > 1 && (
                <div className="p-cat-avail">
                  €{(parseFloat(cat.price_per_night) * nights).toFixed(2)} total · {cat.available_count} available
                </div>
              )}
              {nights <= 1 && (
                <div className="p-cat-avail">{cat.available_count} available</div>
              )}
              <button className="p-btn-gold" onClick={() => handleSelect(cat)} style={{ marginTop: 4 }}>
                Select →
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/screens/OptionsScreen.jsx
git commit -m "feat(portal): OptionsScreen — berth category selection cards"
```

---

## Task 11: Portal — install Stripe + QuoteScreen redesign

**Files:**
- Modify: `portal/package.json`
- Modify: `portal/src/screens/QuoteScreen.jsx`

- [ ] **Step 1: Install Stripe packages**

```bash
cd portal && npm install @stripe/stripe-js @stripe/react-stripe-js
```

- [ ] **Step 2: Replace QuoteScreen**

Replace the entire contents of `portal/src/screens/QuoteScreen.jsx`:

```jsx
import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import api from '../api';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

function formatDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function PayForm({ state, navigate, onSuccess }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [form, setForm] = useState({
    guestName: '', guestEmail: '', guestPhone: '', vesselName: '', eta: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const nights = Math.round((new Date(state.checkOut) - new Date(state.checkIn)) / 86400000);

  const handleSubmit = async e => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true); setError('');

    const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: {
        return_url: `${window.location.origin}${window.location.pathname}`,
      },
    });

    if (stripeError) {
      setError(stripeError.message || 'Payment failed. Please try again.');
      setBusy(false);
      return;
    }

    // Payment succeeded — create the booking
    try {
      const { data } = await api.post('/public/bookings/engine-request/', {
        check_in:  state.checkIn,
        check_out: state.checkOut,
        ...(state.boatLoa   && { boat_loa:   parseFloat(state.boatLoa) }),
        ...(state.boatBeam  && { boat_beam:  parseFloat(state.boatBeam) }),
        ...(state.boatDraft && { boat_draft: parseFloat(state.boatDraft) }),
        guest_name:  form.guestName,
        guest_email: form.guestEmail,
        guest_phone: form.guestPhone,
        vessel_name: form.vesselName,
        eta:         form.eta || null,
        berth_category_id: state.selectedCategory?.id ?? null,
      });
      onSuccess(data.booking?.id);
    } catch (err) {
      if (err.response?.status === 409) {
        navigate('search', { errorBanner: 'Availability changed. Please search again.' });
        return;
      }
      setError('Booking creation failed. Your card was not charged — please contact the marina.');
      setBusy(false);
    }
  };

  const field = (label, key, type = 'text', required = true) => (
    <div className="p-field">
      <label className="p-label">{label}{required ? ' *' : ''}</label>
      <input className="p-input" type={type} required={required}
        value={form[key]} onChange={e => set(key, e.target.value)} />
    </div>
  );

  return (
    <form onSubmit={handleSubmit}>
      <div className="p-section-title">Your details</div>
      <div className="p-grid-2">
        {field('Full name', 'guestName')}
        {field('Email', 'guestEmail', 'email')}
      </div>
      <div className="p-grid-2">
        {field('Phone', 'guestPhone', 'tel', false)}
        {field('Vessel name', 'vesselName', 'text', false)}
      </div>
      <div className="p-field" style={{ maxWidth: 200 }}>
        <label className="p-label">Estimated arrival time</label>
        <input className="p-input" type="time" value={form.eta} onChange={e => set('eta', e.target.value)} />
      </div>

      <div className="p-section-title" style={{ marginTop: 24 }}>Payment</div>
      <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, marginBottom: 20 }}>
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>

      {error && <p className="p-error">{error}</p>}

      <button type="submit" className="p-btn-gold" disabled={busy || !stripe} style={{ width: '100%' }}>
        {busy ? 'Processing…' : `Confirm & Pay €${state.quotedTotal?.toFixed(2)}`}
      </button>
      <p style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 10 }}>
        Your card will be charged on confirmation. The harbor master assigns your exact slip on arrival.
      </p>
    </form>
  );
}

export default function QuoteScreen({ state, navigate, marina }) {
  const [clientSecret, setClientSecret] = useState(null);
  const [intentError, setIntentError] = useState('');
  const nights = Math.round((new Date(state.checkOut) - new Date(state.checkIn)) / 86400000);

  useEffect(() => {
    if (!state.selectedCategory) return; // fallback mode — no intent needed
    api.post('/public/bookings/intent/', {
      berth_category_id: state.selectedCategory.id,
      check_in:  state.checkIn,
      check_out: state.checkOut,
    })
      .then(r => setClientSecret(r.data.client_secret))
      .catch(() => setIntentError('Could not initialise payment. Please go back and try again.'));
  }, [state.selectedCategory?.id]);

  function handleSuccess(bookingId) {
    const slug = window.location.pathname.split('/').filter(Boolean)[0] ?? '';
    window.location.href = `/${slug}/booking/${bookingId}/confirmed`;
  }

  const stripeOptions = {
    clientSecret,
    appearance: {
      theme: 'night',
      variables: { colorPrimary: '#b8965a', colorBackground: '#162d52', fontFamily: 'IBM Plex Sans, system-ui, sans-serif' },
    },
  };

  return (
    <>
      <nav className="p-nav">
        <span className="p-nav-brand">DocksBase</span>
        {marina && <span className="p-nav-marina">— {marina.name}</span>}
      </nav>
      <div className="p-shell">
        <button className="p-btn-outline" onClick={() => navigate(state.selectedCategory ? 'options' : 'search')} style={{ marginBottom: 28 }}>
          ← Back
        </button>

        <div className="p-summary">
          <div>
            <div className="p-summary-label">Category</div>
            <div className="p-summary-val">{state.selectedCategory?.name ?? 'Best available berth'}</div>
          </div>
          <div>
            <div className="p-summary-label">Dates</div>
            <div className="p-summary-val">{formatDate(state.checkIn)} – {formatDate(state.checkOut)}</div>
          </div>
          <div>
            <div className="p-summary-label">Nights</div>
            <div className="p-summary-val">{nights}</div>
          </div>
          <div className="p-summary-total">€{state.quotedTotal?.toFixed(2)}</div>
        </div>

        {intentError && <p className="p-error">{intentError}</p>}

        {/* With Stripe PaymentElement (category flow) */}
        {state.selectedCategory && clientSecret && (
          <Elements stripe={stripePromise} options={stripeOptions}>
            <PayForm state={state} navigate={navigate} onSuccess={handleSuccess} />
          </Elements>
        )}

        {/* Fallback: no category, no PaymentIntent — redirect to Stripe Checkout */}
        {!state.selectedCategory && (
          <FallbackQuoteForm state={state} navigate={navigate} nights={nights} />
        )}
      </div>
    </>
  );
}

function FallbackQuoteForm({ state, navigate, nights }) {
  const [form, setForm] = useState({ guestName: '', guestEmail: '', guestPhone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const { data } = await api.post('/public/bookings/engine-request/', {
        check_in:  state.checkIn, check_out: state.checkOut,
        ...(state.boatLoa   && { boat_loa:   parseFloat(state.boatLoa) }),
        ...(state.boatBeam  && { boat_beam:  parseFloat(state.boatBeam) }),
        ...(state.boatDraft && { boat_draft: parseFloat(state.boatDraft) }),
        guest_name: form.guestName, guest_email: form.guestEmail, guest_phone: form.guestPhone,
      });
      window.location.href = data.checkout_url;
    } catch (err) {
      if (err.response?.status === 409) {
        navigate('search', { errorBanner: 'Availability changed. Please search again.' });
        return;
      }
      setBusy(false);
      setError('Something went wrong. Please try again.');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="p-section-title">Your details</div>
      <div className="p-field"><label className="p-label">Full name *</label><input className="p-input" required value={form.guestName} onChange={e => set('guestName', e.target.value)} /></div>
      <div className="p-field"><label className="p-label">Email *</label><input className="p-input" type="email" required value={form.guestEmail} onChange={e => set('guestEmail', e.target.value)} /></div>
      <div className="p-field"><label className="p-label">Phone</label><input className="p-input" type="tel" value={form.guestPhone} onChange={e => set('guestPhone', e.target.value)} /></div>
      {error && <p className="p-error">{error}</p>}
      <button type="submit" className="p-btn-gold" disabled={busy} style={{ width: '100%' }}>
        {busy ? 'Processing…' : `Book & Pay €${state.quotedTotal?.toFixed(2)}`}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Add VITE_STRIPE_PUBLISHABLE_KEY to portal/.env**

Open `portal/.env` and add:
```
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_51TU4wZEkuKhAX5VjyPqRgPW4t6Ecs7FPTuZjBXrlR8nUzcCt8SRjWdS2jrOmKGFrUyq0k7DAi2JavWednCaV64VS0056dNsQb3
```

- [ ] **Step 4: Commit**

```bash
git add portal/package.json portal/package-lock.json portal/src/screens/QuoteScreen.jsx
git commit -m "feat(portal): QuoteScreen redesign with Stripe PaymentElement"
```

---

## Task 12: Portal — BookingWizard orchestration + BookingConfirmed/BookingRequestSent dark styling

**Files:**
- Modify: `portal/src/screens/BookingWizard.jsx`
- Modify: `portal/src/screens/BookingConfirmed.jsx`
- Modify: `portal/src/screens/BookingRequestSent.jsx`

- [ ] **Step 1: Update BookingWizard.jsx**

Replace the entire contents:

```jsx
import { useState } from 'react';
import SearchScreen from './SearchScreen';
import OptionsScreen from './OptionsScreen';
import AlternativesScreen from './AlternativesScreen';
import QuoteScreen from './QuoteScreen';
import BookingRequestSent from './BookingRequestSent';

const INITIAL_STATE = {
  checkIn: '', checkOut: '', boatLoa: '', boatBeam: '', boatDraft: '',
  quotedPrice: null, quotedTotal: null,
  selectedCategory: null,
  categories: [],
  alternatives: [],
  errorBanner: '',
};

export default function BookingWizard({ marina }) {
  const [screen, setScreen] = useState('search');
  const [state, setState]   = useState(INITIAL_STATE);

  const navigate = (nextScreen, updates = {}) => {
    setState(s => ({ ...s, ...updates, errorBanner: updates.errorBanner ?? '' }));
    setScreen(nextScreen);
  };

  if (screen === 'options')       return <OptionsScreen state={state} navigate={navigate} marina={marina} />;
  if (screen === 'alternatives')  return <AlternativesScreen state={state} navigate={navigate} />;
  if (screen === 'quote')         return <QuoteScreen state={state} navigate={navigate} marina={marina} />;
  if (screen === 'sent')          return <BookingRequestSent marina={marina} />;
  return <SearchScreen state={state} navigate={navigate} marina={marina} />;
}
```

- [ ] **Step 2: Update BookingConfirmed.jsx dark styling**

Replace the contents of `portal/src/screens/BookingConfirmed.jsx`:

```jsx
export default function BookingConfirmed({ marina, bookingId, cancelled }) {
  const slug = window.location.pathname.split('/').filter(Boolean)[0] ?? '';

  return (
    <>
      <nav className="p-nav">
        <span className="p-nav-brand">DocksBase</span>
        {marina && <span className="p-nav-marina">— {marina.name}</span>}
      </nav>
      <div className="p-shell" style={{ maxWidth: 560 }}>
        <div className="p-confirmed-box">
          <div className="p-confirmed-check">{cancelled ? '✕' : '✓'}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            {cancelled ? 'Payment cancelled' : 'Booking confirmed'}
          </div>
          {!cancelled && bookingId && (
            <div className="p-confirmed-id">#{bookingId}</div>
          )}
        </div>

        {cancelled ? (
          <>
            <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 24, textAlign: 'center' }}>
              Your payment was not completed and no charge was made.
            </p>
            <div style={{ textAlign: 'center' }}>
              <a href={`/${slug}`} className="p-btn-gold">Try again</a>
            </div>
          </>
        ) : (
          <>
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
              Your booking is confirmed and visible to the marina team. The harbour master will assign your exact berth on the morning of arrival and contact you via VHF radio or the phone number you provided.
            </div>
          </>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 3: Update BookingRequestSent.jsx dark styling**

Replace `portal/src/screens/BookingRequestSent.jsx`:

```jsx
export default function BookingRequestSent({ marina }) {
  return (
    <>
      <nav className="p-nav">
        <span className="p-nav-brand">DocksBase</span>
        {marina && <span className="p-nav-marina">— {marina.name}</span>}
      </nav>
      <div className="p-shell" style={{ maxWidth: 560 }}>
        <div className="p-confirmed-box">
          <div className="p-confirmed-check">✓</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Request received</div>
          <div className="p-confirmed-id" style={{ fontSize: 16, letterSpacing: 1 }}>Pending review</div>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
          The harbour master will review your request and respond within 24 hours. You will receive a confirmation email with next steps once approved.
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Verify end-to-end in browser**

Start the portal dev server (`npm run dev` in `/portal`). With the backend running, visit `http://localhost:5176/test-marina`. Walk through:
1. Enter dates + dimensions → Search → should navigate to Options (if categories exist) or Quote (fallback)
2. Select a category → QuoteScreen should show summary bar + dark PaymentElement
3. Verify "Back" navigation works at each step

- [ ] **Step 5: Commit**

```bash
git add portal/src/screens/BookingWizard.jsx \
        portal/src/screens/BookingConfirmed.jsx \
        portal/src/screens/BookingRequestSent.jsx
git commit -m "feat(portal): wire OptionsScreen into BookingWizard, dark styling on Confirmed/RequestSent"
```

---

## Task 13: Push everything + open PR

- [ ] **Step 1: Run all backend tests**

```bash
cd backend && python manage.py test apps.berths apps.portal -v 2
```

Expected: all existing tests pass + new tests pass.

- [ ] **Step 2: Run portal tests**

```bash
cd portal && npm test
```

Expected: existing SearchScreen + QuoteScreen tests pass or are updated to match new structure.

- [ ] **Step 3: Push branch**

```bash
git push
```

- [ ] **Step 4: Open PR**

```bash
gh pr create \
  --title "feat: BerthCategory model, portal booking flow redesign, management cleanup" \
  --body "$(cat <<'EOF'
## Summary
- New BerthCategory model (named berth tiers with amenity validation)
- GET /public/bookings/berth-categories/ and POST /public/bookings/intent/ endpoints
- Portal redesigned: dark navy/gold theme, Options screen between Search and Pay
- Management frontend: BoaterPortal screen and ~300 lines of rogue portal CSS removed
- Service Catalog: Berth Categories tab for harbor master configuration

## Test plan
- [ ] Create a BerthCategory in Service Catalog with amenities
- [ ] Visit portal, search with boat dimensions → Options screen shows category cards
- [ ] Select a category → QuoteScreen shows Stripe PaymentElement
- [ ] Confirm & Pay → BookingConfirmed screen
- [ ] Marina with no categories → falls back to old Stripe Checkout flow
- [ ] Management login as boater role → redirects to portal URL

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

- Task 5 (`PublicBerthEngineRequestView`) passes `category_filter` as a note on the booking — full berth-constrained tetris (ensuring the assigned slip is actually in the selected category) is deferred per the user's note about flexible-dock tetris improvements
- 3DS redirect handling: `confirmPayment({ redirect: 'if_required' })` handles most cards inline; cards requiring a full redirect will lose state — acceptable for v1, documented for follow-up
- `portal/.env` is gitignored — Stripe key must be added manually on each dev machine
- The `berthRates` prop in `BerthCategoryPanel` pulls from the `berth` tab's `useServiceCatalog('berth')` — ensure this call is always present regardless of active tab

# Operations & Reservations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire waitlist and fuel dock queue to real backend data, implement a working new-booking form, and introduce a dedicated Operations page for live dock operations.

**Architecture:** Three tracks executed in order — (1) backend: update the reservations app with a hybrid `BookingRequest` model and corrected `Booking` statuses; (2) backend: create a new `fuel_dock` Django app with queue model and POS billing logic; (3) frontend: new hooks replace mock data, Reservations screen gains a New Booking modal, and a new Operations screen hosts the Fuel Dock queue.

**Tech Stack:** Django 5 + DRF + django-filters + SimpleJWT, PostgreSQL via Supabase, React 18 + Vite + Axios.

---

## File Map

**Create:**
- `backend/apps/reservations/tests.py`
- `backend/apps/fuel_dock/__init__.py`
- `backend/apps/fuel_dock/apps.py`
- `backend/apps/fuel_dock/models.py`
- `backend/apps/fuel_dock/notifications.py`
- `backend/apps/fuel_dock/serializers.py`
- `backend/apps/fuel_dock/views.py`
- `backend/apps/fuel_dock/urls.py`
- `backend/apps/fuel_dock/admin.py`
- `backend/apps/fuel_dock/tests.py`
- `backend/apps/fuel_dock/migrations/__init__.py`
- `frontend/src/hooks/useBookingRequests.js`
- `frontend/src/hooks/useFuelQueue.js`
- `frontend/src/screens/Operations.jsx`

**Modify:**
- `backend/apps/reservations/models.py` — update Booking statuses, add BookingRequest
- `backend/apps/reservations/serializers.py` — update BookingSerializer, add BookingRequestSerializer
- `backend/apps/reservations/views.py` — add BookingRequest views
- `backend/apps/reservations/urls.py` — add BookingRequest URL patterns
- `backend/config/settings/base.py` — add `apps.fuel_dock` to LOCAL_APPS
- `backend/config/urls.py` — include fuel_dock URLs
- `frontend/src/screens/Reservations.jsx` — wire waitlist, remove fuel dock tab, add new booking modal
- `frontend/src/components/layout/Sidebar.jsx` — add Operations nav item
- `frontend/src/App.jsx` — add Operations to SCREEN_MAP

---

## Task 1: Update Booking model statuses

**Files:**
- Modify: `backend/apps/reservations/models.py`

- [ ] **Step 1: Replace STATUS_CHOICES in models.py**

Replace the entire `Booking` class with:

```python
from django.db import models


class Booking(models.Model):
    TYPE_CHOICES = [
        ('transient', 'Transient'),
        ('seasonal', 'Seasonal'),
    ]
    STATUS_CHOICES = [
        ('pending',     'Pending'),
        ('checked_in',  'Checked In'),
        ('checked_out', 'Checked Out'),
        ('overstay',    'Overstay'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='bookings')
    berth = models.ForeignKey('berths.Berth', on_delete=models.PROTECT, related_name='bookings')
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.PROTECT, related_name='bookings')
    booking_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='transient')
    check_in = models.DateField()
    check_out = models.DateField()
    nights = models.IntegerField(default=1)
    amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    paid = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'BK-{self.pk} — {self.vessel} @ {self.berth}'
```

- [ ] **Step 2: Generate and apply migration**

```bash
cd backend
python manage.py makemigrations reservations --name booking_status_choices
python manage.py migrate
```

Expected output ends with `Applying reservations.0002_booking_status_choices... OK`

- [ ] **Step 3: Commit**

```bash
git add backend/apps/reservations/models.py backend/apps/reservations/migrations/
git commit -m "feat(reservations): update Booking statuses to pending/checked_in/checked_out/overstay"
```

---

## Task 2: Update BookingSerializer — auto-calculate amount and nights

**Files:**
- Modify: `backend/apps/reservations/serializers.py`
- Modify: `backend/apps/reservations/views.py`

- [ ] **Step 1: Make amount and nights read-only in the serializer**

Replace `backend/apps/reservations/serializers.py`:

```python
from rest_framework import serializers
from .models import Booking


class BookingSerializer(serializers.ModelSerializer):
    vessel_name = serializers.CharField(source='vessel.name', read_only=True)
    berth_code  = serializers.CharField(source='berth.code',  read_only=True)
    owner_name  = serializers.CharField(source='vessel.owner.name', read_only=True, default=None)

    class Meta:
        model = Booking
        fields = [
            'id', 'berth', 'berth_code', 'vessel', 'vessel_name', 'owner_name',
            'booking_type', 'check_in', 'check_out', 'nights', 'amount',
            'status', 'paid', 'notes', 'created_at',
        ]
        read_only_fields = ['id', 'vessel_name', 'berth_code', 'owner_name', 'nights', 'amount', 'created_at']
```

- [ ] **Step 2: Auto-calculate amount and nights in perform_create**

Replace `backend/apps/reservations/views.py`:

```python
from rest_framework import generics
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter
from .models import Booking
from .serializers import BookingSerializer


class BookingListCreateView(generics.ListCreateAPIView):
    serializer_class = BookingSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ['status', 'booking_type', 'paid']
    search_fields = ['vessel__name', 'berth__code']

    def get_queryset(self):
        return Booking.objects.filter(marina=self.request.user.marina).select_related(
            'vessel', 'vessel__owner', 'berth'
        )

    def perform_create(self, serializer):
        check_in  = serializer.validated_data['check_in']
        check_out = serializer.validated_data['check_out']
        berth     = serializer.validated_data['berth']
        nights    = (check_out - check_in).days or 1
        price     = berth.price_per_night
        amount    = (price * nights) if price is not None else None
        serializer.save(marina=self.request.user.marina, nights=nights, amount=amount)


class BookingDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = BookingSerializer

    def get_queryset(self):
        return Booking.objects.filter(marina=self.request.user.marina)
```

- [ ] **Step 3: Commit**

```bash
git add backend/apps/reservations/serializers.py backend/apps/reservations/views.py
git commit -m "feat(reservations): auto-calculate nights and amount on Booking create"
```

---

## Task 3: Add BookingRequest model

**Files:**
- Modify: `backend/apps/reservations/models.py`

- [ ] **Step 1: Append BookingRequest to reservations/models.py**

Add after the `Booking` class:

```python
class BookingRequest(models.Model):
    TYPE_CHOICES = [
        ('transient', 'Transient'),
        ('seasonal',  'Seasonal'),
    ]
    STATUS_CHOICES = [
        ('pending',  'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='booking_requests')

    # Relational path — set when the applicant is a known member
    member = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='booking_requests')
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True, related_name='booking_requests')

    # Free-text path — set when the applicant is a stranger
    guest_name   = models.CharField(max_length=200, blank=True)
    guest_phone  = models.CharField(max_length=50,  blank=True)
    guest_email  = models.CharField(max_length=200, blank=True)
    guest_vessel = models.CharField(max_length=200, blank=True)
    guest_loa    = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)

    # Booking intent
    berth        = models.ForeignKey('berths.Berth', on_delete=models.PROTECT, related_name='booking_requests')
    booking_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='transient')
    start_date   = models.DateField()
    end_date     = models.DateField()
    notes        = models.TextField(blank=True)

    # Lifecycle
    status  = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    booking = models.OneToOneField(Booking, on_delete=models.SET_NULL, null=True, blank=True, related_name='source_request')

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        name = self.member.name if self.member else self.guest_name
        return f'WL-{self.pk} — {name}'

    @property
    def is_stranger(self):
        return self.member is None

    def convert_to_booking(self):
        """Convert a free-text request into Member + Vessel + Booking. Idempotent."""
        if self.booking_id:
            return self.booking

        from apps.members.models import Member
        from apps.vessels.models import Vessel
        import datetime

        if self.is_stranger:
            member = Member.objects.create(
                marina=self.marina,
                name=self.guest_name,
                email=self.guest_email,
                phone=self.guest_phone,
                member_type='transient',
            )
            vessel = Vessel.objects.create(
                marina=self.marina,
                name=self.guest_vessel or f"{self.guest_name}'s Vessel",
                loa=self.guest_loa,
                owner=member,
            )
            self.member = member
            self.vessel = vessel

        nights = (self.end_date - self.start_date).days or 1
        price  = self.berth.price_per_night
        amount = (price * nights) if price is not None else None

        booking = Booking.objects.create(
            marina=self.marina,
            berth=self.berth,
            vessel=self.vessel,
            booking_type=self.booking_type,
            check_in=self.start_date,
            check_out=self.end_date,
            nights=nights,
            amount=amount,
            notes=self.notes,
            status='pending',
        )
        self.booking = booking
        self.status  = 'approved'
        self.save()
        return booking
```

- [ ] **Step 2: Generate and apply migration**

```bash
cd backend
python manage.py makemigrations reservations --name add_bookingrequest
python manage.py migrate
```

Expected: `Applying reservations.0003_add_bookingrequest... OK`

- [ ] **Step 3: Commit**

```bash
git add backend/apps/reservations/models.py backend/apps/reservations/migrations/
git commit -m "feat(reservations): add BookingRequest hybrid model with convert_to_booking()"
```

---

## Task 4: BookingRequest serializer, views, and URLs

**Files:**
- Modify: `backend/apps/reservations/serializers.py`
- Modify: `backend/apps/reservations/views.py`
- Modify: `backend/apps/reservations/urls.py`

- [ ] **Step 1: Add BookingRequestSerializer to serializers.py**

Append to `backend/apps/reservations/serializers.py`:

```python
from .models import Booking, BookingRequest


class BookingRequestSerializer(serializers.ModelSerializer):
    member_name = serializers.CharField(source='member.name', read_only=True, default=None)
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default=None)
    berth_code  = serializers.CharField(source='berth.code',  read_only=True)
    booking_id  = serializers.PrimaryKeyRelatedField(source='booking', read_only=True)

    class Meta:
        model = BookingRequest
        fields = [
            'id', 'member', 'member_name', 'vessel', 'vessel_name',
            'guest_name', 'guest_phone', 'guest_email', 'guest_vessel', 'guest_loa',
            'berth', 'berth_code', 'booking_type', 'start_date', 'end_date', 'notes',
            'status', 'booking_id', 'created_at',
        ]
        read_only_fields = ['id', 'member_name', 'vessel_name', 'berth_code', 'booking_id', 'created_at']
```

- [ ] **Step 2: Add BookingRequest views to views.py**

Append to `backend/apps/reservations/views.py`:

```python
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status as http_status
from rest_framework.permissions import IsAuthenticated
from .models import Booking, BookingRequest
from .serializers import BookingSerializer, BookingRequestSerializer


class BookingRequestListCreateView(generics.ListCreateAPIView):
    serializer_class = BookingRequestSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status', 'booking_type']

    def get_queryset(self):
        return BookingRequest.objects.filter(marina=self.request.user.marina).select_related(
            'member', 'vessel', 'berth', 'booking'
        )

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class BookingRequestDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = BookingRequestSerializer

    def get_queryset(self):
        return BookingRequest.objects.filter(marina=self.request.user.marina)


class ConvertBookingRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            req = BookingRequest.objects.get(pk=pk, marina=request.user.marina)
        except BookingRequest.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        if req.status == 'rejected':
            return Response({'detail': 'Cannot convert a rejected request.'}, status=http_status.HTTP_400_BAD_REQUEST)

        booking = req.convert_to_booking()
        return Response(BookingSerializer(booking).data, status=http_status.HTTP_200_OK)
```

- [ ] **Step 3: Wire URLs in reservations/urls.py**

Replace `backend/apps/reservations/urls.py`:

```python
from django.urls import path
from .views import (
    BookingListCreateView, BookingDetailView,
    BookingRequestListCreateView, BookingRequestDetailView,
    ConvertBookingRequestView,
)

urlpatterns = [
    path('bookings/',                              BookingListCreateView.as_view(),      name='booking_list'),
    path('bookings/<int:pk>/',                     BookingDetailView.as_view(),          name='booking_detail'),
    path('booking-requests/',                      BookingRequestListCreateView.as_view(), name='booking_request_list'),
    path('booking-requests/<int:pk>/',             BookingRequestDetailView.as_view(),    name='booking_request_detail'),
    path('booking-requests/<int:pk>/convert/',     ConvertBookingRequestView.as_view(),   name='booking_request_convert'),
]
```

- [ ] **Step 4: Restart dev server and verify endpoints exist**

```bash
cd backend
python manage.py runserver
```

In a second terminal:
```bash
curl -s http://localhost:8000/api/v1/booking-requests/ -H "Authorization: Bearer <token>" | python -m json.tool
```

Expected: `{"count": 0, "results": []}`

- [ ] **Step 5: Commit**

```bash
git add backend/apps/reservations/serializers.py backend/apps/reservations/views.py backend/apps/reservations/urls.py
git commit -m "feat(reservations): add BookingRequest CRUD and /convert endpoint"
```

---

## Task 5: Write and run BookingRequest tests

**Files:**
- Create: `backend/apps/reservations/tests.py`

- [ ] **Step 1: Write tests**

Create `backend/apps/reservations/tests.py`:

```python
import datetime
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.berths.models import Pier, Berth
from apps.members.models import Member
from apps.vessels.models import Vessel
from .models import Booking, BookingRequest


def make_marina():
    return Marina.objects.create(name='Test Marina')


def make_user(marina):
    return User.objects.create_user(email='staff@test.com', password='pass', marina=marina, role='manager')


def make_berth(marina, price=50):
    pier = Pier.objects.create(marina=marina, code='A', label='Pier A')
    return Berth.objects.create(
        marina=marina, pier=pier, code='A1', price_per_night=price, status='available'
    )


class BookingAmountAutoCalcTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user   = make_user(self.marina)
        self.berth  = make_berth(self.marina, price=50)
        self.member = Member.objects.create(marina=self.marina, name='A. Smith')
        self.vessel = Vessel.objects.create(marina=self.marina, name='Blue Wave', owner=self.member)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_amount_and_nights_calculated_on_create(self):
        resp = self.client.post('/api/v1/bookings/', {
            'berth':        self.berth.id,
            'vessel':       self.vessel.id,
            'booking_type': 'transient',
            'check_in':     '2026-06-01',
            'check_out':    '2026-06-04',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data['nights'], 3)
        self.assertEqual(float(data['amount']), 150.0)


class BookingRequestConvertTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user   = make_user(self.marina)
        self.berth  = make_berth(self.marina, price=50)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_convert_stranger_creates_member_vessel_booking(self):
        req = BookingRequest.objects.create(
            marina=self.marina,
            berth=self.berth,
            booking_type='transient',
            start_date=datetime.date(2026, 6, 1),
            end_date=datetime.date(2026, 6, 3),
            guest_name='J. Doe',
            guest_phone='+353 87 100 0000',
            guest_email='j@example.com',
            guest_vessel='Blue Horizon',
            guest_loa=12,
        )
        resp = self.client.post(f'/api/v1/booking-requests/{req.id}/convert/')
        self.assertEqual(resp.status_code, 200)
        req.refresh_from_db()
        self.assertEqual(req.status, 'approved')
        self.assertIsNotNone(req.booking)
        self.assertIsNotNone(req.member)
        self.assertIsNotNone(req.vessel)
        self.assertEqual(req.booking.nights, 2)
        self.assertEqual(float(req.booking.amount), 100.0)
        self.assertEqual(req.member.name, 'J. Doe')
        self.assertEqual(req.vessel.name, 'Blue Horizon')

    def test_convert_is_idempotent(self):
        req = BookingRequest.objects.create(
            marina=self.marina,
            berth=self.berth,
            booking_type='transient',
            start_date=datetime.date(2026, 6, 1),
            end_date=datetime.date(2026, 6, 2),
            guest_name='K. Oduya',
            guest_vessel='Pelican',
        )
        resp1 = self.client.post(f'/api/v1/booking-requests/{req.id}/convert/')
        resp2 = self.client.post(f'/api/v1/booking-requests/{req.id}/convert/')
        self.assertEqual(resp1.status_code, 200)
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp1.json()['id'], resp2.json()['id'])
        self.assertEqual(Booking.objects.filter(marina=self.marina).count(), 1)

    def test_convert_relational_request_skips_profile_creation(self):
        member = Member.objects.create(marina=self.marina, name='G. Ferreira')
        vessel = Vessel.objects.create(marina=self.marina, name='Sunrise II', owner=member)
        req = BookingRequest.objects.create(
            marina=self.marina,
            berth=self.berth,
            booking_type='seasonal',
            start_date=datetime.date(2026, 6, 1),
            end_date=datetime.date(2026, 6, 8),
            member=member,
            vessel=vessel,
        )
        resp = self.client.post(f'/api/v1/booking-requests/{req.id}/convert/')
        self.assertEqual(resp.status_code, 200)
        req.refresh_from_db()
        self.assertEqual(req.member, member)
        self.assertEqual(req.vessel, vessel)
```

- [ ] **Step 2: Run tests**

```bash
cd backend
python manage.py test apps.reservations.tests -v 2
```

Expected: `Ran 4 tests in X.XXXs — OK`

- [ ] **Step 3: Commit**

```bash
git add backend/apps/reservations/tests.py
git commit -m "test(reservations): BookingRequest amount calc and convert_to_booking tests"
```

---

## Task 6: Create fuel_dock app skeleton

**Files:**
- Create: `backend/apps/fuel_dock/__init__.py`
- Create: `backend/apps/fuel_dock/apps.py`
- Create: `backend/apps/fuel_dock/admin.py`
- Create: `backend/apps/fuel_dock/migrations/__init__.py`

- [ ] **Step 1: Create app files**

`backend/apps/fuel_dock/__init__.py` — empty file.

`backend/apps/fuel_dock/apps.py`:
```python
from django.apps import AppConfig


class FuelDockConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.fuel_dock'
    verbose_name = 'Fuel Dock'
```

`backend/apps/fuel_dock/admin.py`:
```python
from django.contrib import admin
from .models import FuelDockEntry

admin.site.register(FuelDockEntry)
```

`backend/apps/fuel_dock/migrations/__init__.py` — empty file.

`backend/apps/fuel_dock/notifications.py`:
```python
import logging

logger = logging.getLogger(__name__)


def notify_sms(phone: str, message: str) -> None:
    """Stub — replace body with Twilio/Vonage SDK call when provider is chosen."""
    if not phone:
        return
    logger.info('SMS → %s: %s', phone, message)
```

- [ ] **Step 2: Register in settings**

In `backend/config/settings/base.py`, add `'apps.fuel_dock'` to LOCAL_APPS:

```python
LOCAL_APPS = [
    'apps.accounts',
    'apps.berths',
    'apps.reservations',
    'apps.vessels',
    'apps.members',
    'apps.billing',
    'apps.maintenance',
    'apps.staff',
    'apps.boatyard',
    'apps.documents',
    'apps.restaurant',
    'apps.events',
    'apps.sales',
    'apps.reports',
    'apps.fuel_dock',
]
```

- [ ] **Step 3: Commit skeleton**

```bash
git add backend/apps/fuel_dock/ backend/config/settings/base.py
git commit -m "feat(fuel_dock): create app skeleton and SMS notification stub"
```

---

## Task 7: FuelDockEntry model and migration

**Files:**
- Create: `backend/apps/fuel_dock/models.py`

- [ ] **Step 1: Write the model**

`backend/apps/fuel_dock/models.py`:

```python
from django.db import models


class FuelDockEntry(models.Model):
    FUEL_TYPE_CHOICES = [
        ('diesel',   'Diesel'),
        ('petrol',   'Petrol'),
        ('pump_out', 'Pump-out'),
    ]
    STATUS_CHOICES = [
        ('waiting',   'Waiting'),
        ('next',      'Next'),
        ('service',   'Service'),
        ('completed', 'Completed'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='fuel_queue')

    # Relational path
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True, related_name='fuel_entries')
    member = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='fuel_entries')

    # Free-text path
    guest_description = models.CharField(max_length=300, blank=True)
    guest_phone       = models.CharField(max_length=50,  blank=True)

    # Fuel details
    fuel_type         = models.CharField(max_length=20, choices=FUEL_TYPE_CHOICES, blank=True)
    estimated_litres  = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    actual_litres     = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    price_per_litre   = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True)
    total_amount      = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    # Queue state
    status     = models.CharField(max_length=20, choices=STATUS_CHOICES, default='waiting')
    fuel_berth = models.CharField(max_length=20, blank=True)

    # Timestamps
    arrived_at    = models.DateTimeField(auto_now_add=True)
    service_start = models.DateTimeField(null=True, blank=True)
    completed_at  = models.DateTimeField(null=True, blank=True)

    # Billing outcome (mutually exclusive)
    invoice  = models.ForeignKey('billing.Invoice', on_delete=models.SET_NULL, null=True, blank=True, related_name='fuel_entries')
    pos_paid = models.BooleanField(default=False)

    class Meta:
        ordering = ['arrived_at']

    def __str__(self):
        name = self.vessel.name if self.vessel else self.guest_description
        return f'FQ-{self.pk} — {name} ({self.status})'
```

- [ ] **Step 2: Generate and apply migration**

```bash
cd backend
python manage.py makemigrations fuel_dock --name initial
python manage.py migrate
```

Expected: `Applying fuel_dock.0001_initial... OK`

- [ ] **Step 3: Commit**

```bash
git add backend/apps/fuel_dock/models.py backend/apps/fuel_dock/migrations/
git commit -m "feat(fuel_dock): add FuelDockEntry model with queue state machine fields"
```

---

## Task 8: FuelDockEntry serializer, views, and URLs

**Files:**
- Create: `backend/apps/fuel_dock/serializers.py`
- Create: `backend/apps/fuel_dock/views.py`
- Create: `backend/apps/fuel_dock/urls.py`
- Modify: `backend/config/urls.py`

- [ ] **Step 1: Write serializer**

`backend/apps/fuel_dock/serializers.py`:

```python
from rest_framework import serializers
from .models import FuelDockEntry


class FuelDockEntrySerializer(serializers.ModelSerializer):
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default=None)
    member_name = serializers.CharField(source='member.name', read_only=True, default=None)
    member_phone = serializers.CharField(source='member.phone', read_only=True, default=None)

    class Meta:
        model = FuelDockEntry
        fields = [
            'id', 'vessel', 'vessel_name', 'member', 'member_name', 'member_phone',
            'guest_description', 'guest_phone',
            'fuel_type', 'estimated_litres', 'actual_litres', 'price_per_litre', 'total_amount',
            'status', 'fuel_berth',
            'arrived_at', 'service_start', 'completed_at',
            'invoice', 'pos_paid',
        ]
        read_only_fields = ['id', 'vessel_name', 'member_name', 'member_phone',
                            'total_amount', 'arrived_at', 'service_start', 'completed_at',
                            'invoice', 'pos_paid']
```

- [ ] **Step 2: Write views**

`backend/apps/fuel_dock/views.py`:

```python
import datetime
from django.utils import timezone
from rest_framework import generics, serializers as drf_serializers, status as http_status
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from .models import FuelDockEntry
from .serializers import FuelDockEntrySerializer
from .notifications import notify_sms


VALID_TRANSITIONS = {
    'waiting':  'next',
    'next':     'service',
    'service':  'completed',
}


def _get_phone(entry):
    if entry.member and entry.member.phone:
        return entry.member.phone
    return entry.guest_phone


def _bill_completion(entry, total_amount, now):
    """Route billing on completion. Returns dict of extra fields to save on the entry."""
    from apps.billing.models import Invoice

    if entry.member_id and total_amount is not None:
        due = now.date() + datetime.timedelta(days=entry.marina.payment_terms)
        invoice = Invoice.objects.create(
            marina=entry.marina,
            member=entry.member,
            vessel=entry.vessel,
            invoice_type='fuel',
            amount=total_amount,
            issued=now.date(),
            due=due,
            status='unpaid',
        )
        return {'invoice': invoice}

    return {'pos_paid': True}


class FuelQueueListCreateView(generics.ListCreateAPIView):
    serializer_class = FuelDockEntrySerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status', 'fuel_berth']

    def get_queryset(self):
        qs = FuelDockEntry.objects.filter(marina=self.request.user.marina).select_related(
            'vessel', 'member', 'invoice'
        )
        if self.request.query_params.get('active', '1') == '1':
            qs = qs.exclude(status='completed')
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class FuelQueueDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = FuelDockEntrySerializer

    def get_queryset(self):
        return FuelDockEntry.objects.filter(marina=self.request.user.marina).select_related(
            'vessel', 'member'
        )

    def perform_update(self, serializer):
        entry      = self.get_object()
        new_status = serializer.validated_data.get('status', entry.status)
        now        = timezone.now()
        extra      = {}

        if new_status != entry.status:
            expected_next = VALID_TRANSITIONS.get(entry.status)
            if new_status != expected_next:
                raise drf_serializers.ValidationError(
                    {'status': f'Invalid transition: {entry.status} → {new_status}'}
                )
            if new_status == 'next':
                notify_sms(_get_phone(entry), 'Please approach the fuel dock — you are next.')
            if new_status == 'service':
                extra['service_start'] = now
            if new_status == 'completed':
                actual = serializer.validated_data.get('actual_litres', entry.actual_litres)
                price  = serializer.validated_data.get('price_per_litre', entry.price_per_litre)
                total  = (actual * price) if (actual and price) else None
                extra['completed_at']  = now
                extra['total_amount']  = total
                extra.update(_bill_completion(entry, total, now))

        serializer.save(**extra)
```

- [ ] **Step 4: Write URLs**

`backend/apps/fuel_dock/urls.py`:

```python
from django.urls import path
from .views import FuelQueueListCreateView, FuelQueueDetailView

urlpatterns = [
    path('fuel-dock/queue/',         FuelQueueListCreateView.as_view(), name='fuel_queue_list'),
    path('fuel-dock/queue/<int:pk>/', FuelQueueDetailView.as_view(),    name='fuel_queue_detail'),
]
```

- [ ] **Step 5: Include in root URLs**

In `backend/config/urls.py` add the fuel_dock include:

```python
from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/v1/', include([
        path('auth/',   include('apps.accounts.urls')),
        path('',        include('apps.berths.urls')),
        path('',        include('apps.reservations.urls')),
        path('',        include('apps.vessels.urls')),
        path('',        include('apps.members.urls')),
        path('',        include('apps.billing.urls')),
        path('',        include('apps.maintenance.urls')),
        path('',        include('apps.staff.urls')),
        path('',        include('apps.boatyard.urls')),
        path('',        include('apps.documents.urls')),
        path('',        include('apps.restaurant.urls')),
        path('',        include('apps.events.urls')),
        path('',        include('apps.sales.urls')),
        path('',        include('apps.reports.urls')),
        path('',        include('apps.fuel_dock.urls')),
        path('marina/', include('apps.accounts.marina_urls')),
    ])),
]
```

- [ ] **Step 6: Verify endpoint**

```bash
cd backend
python manage.py runserver
```

```bash
curl -s http://localhost:8000/api/v1/fuel-dock/queue/ -H "Authorization: Bearer <token>"
```

Expected: `{"count": 0, "results": []}`

- [ ] **Step 7: Commit**

```bash
git add backend/apps/fuel_dock/serializers.py backend/apps/fuel_dock/views.py backend/apps/fuel_dock/urls.py backend/config/urls.py
git commit -m "feat(fuel_dock): add FuelDockEntry API with state machine and billing routing"
```

---

## Task 9: Write and run FuelDockEntry billing tests

**Files:**
- Create: `backend/apps/fuel_dock/tests.py`

- [ ] **Step 1: Write tests**

`backend/apps/fuel_dock/tests.py`:

```python
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.berths.models import Pier, Berth
from apps.members.models import Member
from apps.vessels.models import Vessel
from apps.billing.models import Invoice
from .models import FuelDockEntry


def make_marina():
    return Marina.objects.create(name='Test Marina')


def make_user(marina):
    return User.objects.create_user(email='staff@test.com', password='pass', marina=marina)


class FuelDockBillingTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user   = make_user(self.marina)
        self.member = Member.objects.create(marina=self.marina, name='L. Nakamura', phone='+353 87 100 0000')
        self.vessel = Vessel.objects.create(marina=self.marina, name='Ocean Star', owner=self.member)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _create_entry(self, **kwargs):
        defaults = dict(marina=self.marina, fuel_type='diesel', status='service', fuel_berth='FD-1')
        defaults.update(kwargs)
        return FuelDockEntry.objects.create(**defaults)

    def test_member_completion_creates_fuel_invoice(self):
        entry = self._create_entry(vessel=self.vessel, member=self.member)
        resp = self.client.patch(f'/api/v1/fuel-dock/queue/{entry.id}/', {
            'status':          'completed',
            'actual_litres':   '100.00',
            'price_per_litre': '1.95',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        entry.refresh_from_db()
        self.assertEqual(entry.status, 'completed')
        self.assertAlmostEqual(float(entry.total_amount), 195.0)
        self.assertIsNotNone(entry.invoice)
        self.assertEqual(entry.invoice.invoice_type, 'fuel')
        self.assertAlmostEqual(float(entry.invoice.amount), 195.0)
        self.assertFalse(entry.pos_paid)

    def test_stranger_completion_sets_pos_paid_no_invoice(self):
        entry = self._create_entry(guest_description='White Sailboat', guest_phone='+353 87 999 0000')
        resp = self.client.patch(f'/api/v1/fuel-dock/queue/{entry.id}/', {
            'status':          'completed',
            'actual_litres':   '50.00',
            'price_per_litre': '2.10',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        entry.refresh_from_db()
        self.assertTrue(entry.pos_paid)
        self.assertIsNone(entry.invoice)

    def test_invalid_status_transition_rejected(self):
        entry = self._create_entry(guest_description='Mystery Boat', status='waiting')
        resp = self.client.patch(f'/api/v1/fuel-dock/queue/{entry.id}/', {
            'status': 'completed',
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_state_machine_advances_in_order(self):
        entry = self._create_entry(guest_description='Test Boat', status='waiting')
        for expected_status in ['next', 'service', 'completed']:
            resp = self.client.patch(f'/api/v1/fuel-dock/queue/{entry.id}/', {
                'status':          expected_status,
                'actual_litres':   '20.00' if expected_status == 'completed' else None,
                'price_per_litre': '1.80'  if expected_status == 'completed' else None,
            }, format='json')
            self.assertEqual(resp.status_code, 200, f'Failed advancing to {expected_status}')
            entry.refresh_from_db()
            self.assertEqual(entry.status, expected_status)
```

- [ ] **Step 2: Run tests**

```bash
cd backend
python manage.py test apps.fuel_dock.tests apps.reservations.tests -v 2
```

Expected: `Ran 8 tests in X.XXXs — OK`

- [ ] **Step 3: Commit**

```bash
git add backend/apps/fuel_dock/tests.py
git commit -m "test(fuel_dock): billing routing and state machine tests"
```

---

## Task 10: Frontend — useBookingRequests hook

**Files:**
- Create: `frontend/src/hooks/useBookingRequests.js`

- [ ] **Step 1: Write hook**

`frontend/src/hooks/useBookingRequests.js`:

```javascript
import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useBookingRequests(filters = {}) {
  const [requests, setRequests] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/booking-requests/', { params: filters });
      setRequests(data.results ?? data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(filters)]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  async function updateRequest(id, patch) {
    const { data } = await api.patch(`/booking-requests/${id}/`, patch);
    setRequests(prev => prev.map(r => r.id === id ? data : r));
    return data;
  }

  async function convertRequest(id) {
    const { data } = await api.post(`/booking-requests/${id}/convert/`);
    await fetchRequests();
    return data;
  }

  async function createRequest(payload) {
    const { data } = await api.post('/booking-requests/', payload);
    setRequests(prev => [...prev, data]);
    return data;
  }

  return { requests, loading, error, refetch: fetchRequests, updateRequest, convertRequest, createRequest };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useBookingRequests.js
git commit -m "feat(frontend): add useBookingRequests hook"
```

---

## Task 11: Frontend — useFuelQueue hook

**Files:**
- Create: `frontend/src/hooks/useFuelQueue.js`

- [ ] **Step 1: Write hook**

`frontend/src/hooks/useFuelQueue.js`:

```javascript
import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useFuelQueue() {
  const [queue,   setQueue]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const fetchQueue = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/fuel-dock/queue/', { params: { active: 1 } });
      setQueue(data.results ?? data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  async function addToQueue(payload) {
    const { data } = await api.post('/fuel-dock/queue/', payload);
    setQueue(prev => [...prev, data]);
    return data;
  }

  async function advanceEntry(id, patch) {
    const { data } = await api.patch(`/fuel-dock/queue/${id}/`, patch);
    setQueue(prev => prev.map(e => e.id === id ? data : e).filter(e => e.status !== 'completed'));
    return data;
  }

  async function removeEntry(id) {
    await api.delete(`/fuel-dock/queue/${id}/`);
    setQueue(prev => prev.filter(e => e.id !== id));
  }

  return { queue, loading, error, refetch: fetchQueue, addToQueue, advanceEntry, removeEntry };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useFuelQueue.js
git commit -m "feat(frontend): add useFuelQueue hook"
```

---

## Task 12: Update Reservations.jsx — wire waitlist, remove fuel dock tab, add New Booking modal

**Files:**
- Modify: `frontend/src/screens/Reservations.jsx`

- [ ] **Step 1: Replace Reservations.jsx entirely**

`frontend/src/screens/Reservations.jsx`:

```jsx
import { useState } from 'react';
import useBookings from '../hooks/useBookings.js';
import useBookingRequests from '../hooks/useBookingRequests.js';
import useVessels from '../hooks/useVessels.js';
import useBerths from '../hooks/useBerths.js';
import StatusBadge from '../components/ui/Badge.jsx';
import Ic from '../components/ui/Icon.jsx';
import api from '../api.js';

const filterMap = {
  all:       {},
  transient: { booking_type: 'transient' },
  seasonal:  { booking_type: 'seasonal' },
  pending:   { status: 'pending' },
  overdue:   { status: 'overstay' },
};

const bookingTabs = ['all', 'transient', 'seasonal', 'pending', 'overdue'];

function fmt(b) {
  return {
    ...b,
    vessel:   b.vessel_name  ?? b.vessel  ?? '—',
    owner:    b.owner_name   ?? b.owner   ?? '—',
    berth:    b.berth_code   ?? b.berth   ?? '—',
    checkin:  b.check_in     ?? b.checkin ?? '—',
    checkout: b.check_out    ?? b.checkout ?? '—',
    type:     b.booking_type ? (b.booking_type.charAt(0).toUpperCase() + b.booking_type.slice(1)) : (b.type ?? '—'),
    amount:   b.amount != null ? `€${Number(b.amount).toLocaleString('de-DE', { minimumFractionDigits: 2 })}` : '—',
  };
}

function NewBookingModal({ onClose, onCreated }) {
  const { vessels } = useVessels();
  const { berths }  = useBerths();
  const availableBerths = berths.filter(b => b.status === 'available');

  const [form, setForm] = useState({
    vessel: '', berth: '', booking_type: 'transient', check_in: '', check_out: '', notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const selectedBerth = availableBerths.find(b => b.id === Number(form.berth));
  const nights = (form.check_in && form.check_out)
    ? Math.max(1, Math.round((new Date(form.check_out) - new Date(form.check_in)) / 86400000))
    : null;
  const amountPreview = (selectedBerth?.price_per_night && nights)
    ? `€${(selectedBerth.price_per_night * nights).toLocaleString('de-DE', { minimumFractionDigits: 2 })}`
    : '—';

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post('/bookings/', {
        vessel:       Number(form.vessel),
        berth:        Number(form.berth),
        booking_type: form.booking_type,
        check_in:     form.check_in,
        check_out:    form.check_out,
        notes:        form.notes,
      });
      onCreated(data);
    } catch (err) {
      setError(err.response?.data ? JSON.stringify(err.response.data) : 'Failed to create booking.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 480, padding: 24, position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>New Booking</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Ic n="x" s={12} /></button>
        </div>
        <form onSubmit={submit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>
              Vessel
              <select className="input" value={form.vessel} onChange={e => set('vessel', e.target.value)} required style={{ marginTop: 4, width: '100%' }}>
                <option value="">Select vessel…</option>
                {vessels.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, fontWeight: 600 }}>
              Berth (available only)
              <select className="input" value={form.berth} onChange={e => set('berth', e.target.value)} required style={{ marginTop: 4, width: '100%' }}>
                <option value="">Select berth…</option>
                {availableBerths.map(b => (
                  <option key={b.id} value={b.id}>{b.code}{b.price_per_night ? ` — €${b.price_per_night}/night` : ''}</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12, fontWeight: 600 }}>
              Type
              <select className="input" value={form.booking_type} onChange={e => set('booking_type', e.target.value)} style={{ marginTop: 4, width: '100%' }}>
                <option value="transient">Transient</option>
                <option value="seasonal">Seasonal</option>
              </select>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600 }}>
                Check-in
                <input type="date" className="input" value={form.check_in} onChange={e => set('check_in', e.target.value)} required style={{ marginTop: 4, width: '100%' }} />
              </label>
              <label style={{ fontSize: 12, fontWeight: 600 }}>
                Check-out
                <input type="date" className="input" value={form.check_out} onChange={e => set('check_out', e.target.value)} required style={{ marginTop: 4, width: '100%' }} />
              </label>
            </div>
            <label style={{ fontSize: 12, fontWeight: 600 }}>
              Notes
              <textarea className="input" value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} style={{ marginTop: 4, width: '100%', resize: 'vertical' }} />
            </label>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f5f8ff', borderRadius: 6 }}>
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>Estimated amount {nights ? `(${nights} nights)` : ''}</span>
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--navy)' }}>{amountPreview}</span>
            </div>
            {error && <div style={{ fontSize: 12, color: 'var(--red)', padding: '8px 12px', background: '#fff5f5', borderRadius: 6 }}>{error}</div>}
            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ justifyContent: 'center' }}>
              {submitting ? 'Creating…' : 'Create Booking'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Reservations() {
  const [tab, setTab] = useState('all');
  const [sel, setSel] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const { bookings, loading, updateBooking, refetch } = useBookings(
    bookingTabs.includes(tab) ? filterMap[tab] : {}
  );
  const { requests, loading: wlLoading, convertRequest } = useBookingRequests(
    tab === 'waitlist' ? { status: 'pending' } : {}
  );

  const rows = bookings.map(fmt);

  async function markPaid(b) {
    await updateBooking(b.id, { paid: true, status: 'checked_in' });
    setSel(prev => prev?.id === b.id ? { ...prev, paid: true, status: 'checked_in' } : prev);
  }

  async function offerBerth(id) {
    await convertRequest(id);
  }

  return (
    <div>
      {showModal && (
        <NewBookingModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); refetch(); }}
        />
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <div className="search"><Ic n="search" s={13} /><input placeholder="Search vessel, owner, booking…" /></div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}><Ic n="plus" s={12} />New Booking</button>
      </div>
      <div className="tabs">
        {[['all','All'],['transient','Transient'],['seasonal','Seasonal'],['pending','Pending'],['overdue','Overdue'],['waitlist','Wait List']].map(([v,l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => { setTab(v); setSel(null); }}>{l}</div>
        ))}
      </div>

      {bookingTabs.includes(tab) && (
        <div style={{ display: 'grid', gridTemplateColumns: sel ? '1fr 300px' : '1fr', gap: 16, alignItems: 'start' }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead>
                <tr><th>Booking</th><th>Vessel / Owner</th><th>Slip</th><th>Dates</th><th>Type</th><th>Status</th><th>Amount</th></tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No bookings found.</td></tr>
                ) : rows.map(b => (
                  <tr key={b.id} style={{ cursor: 'pointer', background: sel?.id === b.id ? '#f5f8ff' : '' }} onClick={() => setSel(b)}>
                    <td><div className="tbl-name">{b.id}</div></td>
                    <td><div className="tbl-name">{b.vessel}</div><div className="tbl-sub">{b.owner}</div></td>
                    <td style={{ fontWeight: 600, color: 'var(--navy)' }}>{b.berth}</td>
                    <td><div style={{ fontSize: 12 }}>{b.checkin} → {b.checkout}</div><div className="tbl-sub">{b.nights} nights</div></td>
                    <td><StatusBadge s={b.type} /></td>
                    <td><StatusBadge s={b.status} /></td>
                    <td><div style={{ fontWeight: 600 }}>{b.amount}</div><div className="tbl-sub">{b.paid ? 'Paid' : 'Unpaid'}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {sel && (
            <div className="detail">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <div className="detail-title">{sel.id}</div>
                <button className="btn btn-ghost btn-sm" onClick={() => setSel(null)} style={{ padding: '3px 7px' }}><Ic n="x" s={12} /></button>
              </div>
              <StatusBadge s={sel.status} />
              <div style={{ marginTop: 14 }}>
                {[['Vessel',sel.vessel],['Owner',sel.owner],['Slip',sel.berth],['Check-in',sel.checkin],['Check-out',sel.checkout],['Duration',`${sel.nights} nights`],['Type',sel.type],['Amount',sel.amount],['Payment',sel.paid?'Paid':'Outstanding']].map(([k,v]) => (
                  <div key={k} className="detail-row">
                    <div className="detail-key">{k}</div>
                    <div className="detail-val" style={{ color: k==='Payment' && !sel.paid ? 'var(--orange)' : k==='Payment' ? 'var(--green)' : undefined }}>{v}</div>
                  </div>
                ))}
              </div>
              <div className="detail-actions">
                {!sel.paid && <button className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={() => markPaid(sel)}>Mark as Paid</button>}
                <button className="btn btn-ghost" style={{ justifyContent: 'center' }}>Edit Booking</button>
                <button className="btn btn-danger" style={{ justifyContent: 'center' }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'waitlist' && (
        <div>
          <div className="sec-hdr">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="sec-hdr-title">Berth Wait List</div>
              <span className="badge badge-navy">{requests.length}</span>
            </div>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Applicant / Vessel</th><th>LOA</th><th>Berth Requested</th><th>Dates</th><th>Type</th><th>Status</th><th>Notes</th><th></th></tr></thead>
              <tbody>
                {wlLoading ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: '20px 0', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>Loading…</td></tr>
                ) : requests.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: '20px 0', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>No pending requests.</td></tr>
                ) : requests.map(w => (
                  <tr key={w.id}>
                    <td>
                      <div className="tbl-name">{w.member_name || w.guest_name || '—'}</div>
                      <div className="tbl-sub">{w.vessel_name || w.guest_vessel || '—'}</div>
                    </td>
                    <td style={{ fontWeight: 600 }}>{w.guest_loa ? `${w.guest_loa}m` : '—'}</td>
                    <td style={{ fontWeight: 600, color: 'var(--navy)' }}>{w.berth_code}</td>
                    <td style={{ fontSize: 12 }}>{w.start_date} → {w.end_date}</td>
                    <td><span className="badge badge-navy">{w.booking_type}</span></td>
                    <td><StatusBadge s={w.status} /></td>
                    <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>{w.notes || '—'}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-primary btn-sm" onClick={() => offerBerth(w.id)}>Offer Berth</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Start the dev server (`npm run dev` in `frontend/`) and:
- Open Reservations — check that the Fuel Dock tab is gone
- Click "New Booking" — modal should open with vessel/berth selects populated
- Select a vessel, an available berth, dates — verify amount preview updates
- Submit — booking should appear in the All tab
- Switch to Wait List tab — should show loading then real data (empty if none yet)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/screens/Reservations.jsx
git commit -m "feat(frontend): wire waitlist to real API, add New Booking modal, remove fuel dock tab"
```

---

## Task 13: Create Operations.jsx screen

**Files:**
- Create: `frontend/src/screens/Operations.jsx`

- [ ] **Step 1: Write the screen**

`frontend/src/screens/Operations.jsx`:

```jsx
import { useState } from 'react';
import useFuelQueue from '../hooks/useFuelQueue.js';
import useVessels from '../hooks/useVessels.js';
import StatusBadge from '../components/ui/Badge.jsx';
import Ic from '../components/ui/Icon.jsx';

const FUEL_BERTHS = ['FD-1', 'FD-2'];

function AddQueueForm({ vessels, onAdd, onCancel }) {
  const [mode, setMode] = useState('stranger'); // 'member' | 'stranger'
  const [form, setForm] = useState({
    vessel: '', guest_description: '', guest_phone: '',
    fuel_type: 'diesel', estimated_litres: '',
  });
  const [submitting, setSubmitting] = useState(false);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    const payload = {
      fuel_type:        form.fuel_type,
      estimated_litres: form.estimated_litres || null,
    };
    if (mode === 'member' && form.vessel) {
      const v = vessels.find(v => v.id === Number(form.vessel));
      payload.vessel = Number(form.vessel);
      if (v?.owner) payload.member = v.owner;  // DRF serializes FK as integer under field name, not field_id
    } else {
      payload.guest_description = form.guest_description;
      payload.guest_phone       = form.guest_phone;
    }
    await onAdd(payload);
    setSubmitting(false);
  }

  return (
    <div className="card" style={{ padding: 18, marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Add to Queue</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[['member','Known Vessel'],['stranger','Free Text']].map(([v,l]) => (
          <button key={v} className={`btn ${mode === v ? 'btn-primary' : 'btn-ghost'} btn-sm`} onClick={() => setMode(v)}>{l}</button>
        ))}
      </div>
      <form onSubmit={submit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {mode === 'member' ? (
            <select className="input" value={form.vessel} onChange={e => set('vessel', e.target.value)} required>
              <option value="">Select vessel…</option>
              {vessels.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          ) : (
            <>
              <input className="input" placeholder='Description (e.g. "White Sailboat")' value={form.guest_description} onChange={e => set('guest_description', e.target.value)} />
              <input className="input" placeholder="Phone number" value={form.guest_phone} onChange={e => set('guest_phone', e.target.value)} />
            </>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <select className="input" value={form.fuel_type} onChange={e => set('fuel_type', e.target.value)}>
              <option value="diesel">Diesel</option>
              <option value="petrol">Petrol</option>
              <option value="pump_out">Pump-out</option>
            </select>
            <input className="input" placeholder="Est. litres" type="number" value={form.estimated_litres} onChange={e => set('estimated_litres', e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>{submitting ? 'Adding…' : 'Add to Queue'}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function CompletionForm({ entry, onComplete, onCancel }) {
  const [litres, setLitres]  = useState('');
  const [price,  setPrice]   = useState('');
  const [saving, setSaving]  = useState(false);

  const preview = (litres && price) ? `€${(litres * price).toFixed(2)}` : '—';

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    await onComplete(entry.id, {
      status:          'completed',
      actual_litres:   litres,
      price_per_litre: price,
    });
    setSaving(false);
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input className="input" placeholder="Actual litres" type="number" step="0.01" value={litres} onChange={e => setLitres(e.target.value)} style={{ width: 110 }} required />
      <input className="input" placeholder="€/litre" type="number" step="0.0001" value={price} onChange={e => setPrice(e.target.value)} style={{ width: 90 }} required />
      <span style={{ fontSize: 12, fontWeight: 700 }}>{preview}</span>
      <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Complete'}</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
    </form>
  );
}

function FuelDockTab() {
  const { queue, loading, addToQueue, advanceEntry, removeEntry } = useFuelQueue();
  const { vessels } = useVessels();
  const [showAddForm, setShowAddForm]   = useState(false);
  const [completingId, setCompletingId] = useState(null);

  const NEXT_LABEL = { waiting: 'Next', next: 'To Berth', service: 'Complete' };

  async function handleAdvance(entry) {
    if (entry.status === 'service') {
      setCompletingId(entry.id);
    } else {
      const nextStatus = { waiting: 'next', next: 'service' }[entry.status];
      await advanceEntry(entry.id, { status: nextStatus });
    }
  }

  async function handleComplete(id, patch) {
    await advanceEntry(id, patch);
    setCompletingId(null);
  }

  const serviceEntries = queue.filter(e => e.status === 'service');
  const activeQueue    = queue.filter(e => e.status !== 'service');

  return (
    <div>
      <div className="sec-hdr">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="sec-hdr-title">Fuel Dock — Live Queue</div>
          <span className="badge badge-teal">{queue.filter(q => q.status === 'service').length} Fuelling</span>
          <span className="badge badge-gray">{queue.filter(q => q.status === 'waiting').length} Waiting</span>
          {queue.filter(q => q.status === 'next').length > 0 && (
            <span className="badge badge-gold">{queue.filter(q => q.status === 'next').length} Next</span>
          )}
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAddForm(v => !v)}>
          <Ic n="plus" s={11} />Add to Queue
        </button>
      </div>

      {showAddForm && (
        <AddQueueForm
          vessels={vessels}
          onAdd={async payload => { await addToQueue(payload); setShowAddForm(false); }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>Loading…</div>
      ) : (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Fuel Dock Berths</div>
            {FUEL_BERTHS.map(berth => {
              const occ = serviceEntries.find(e => e.fuel_berth === berth);
              return (
                <div key={berth} className="fuel-berth">
                  <div className="fuel-berth-id">{berth}</div>
                  {occ ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{occ.vessel_name || occ.guest_description}</div>
                        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)', marginTop: 2 }}>{occ.member_name || ''}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="badge badge-teal">{occ.fuel_type}</span>
                        <span className="badge badge-teal">Fuelling</span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', fontStyle: 'italic' }}>Available</div>
                  )}
                </div>
              );
            })}
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Queue</div>
            {queue.length === 0 ? (
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', fontStyle: 'italic', padding: '12px 0' }}>Queue is empty.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {queue.map((q, idx) => (
                  <div key={q.id} className="card" style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div className="lq-num">{idx + 1}</div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>{q.vessel_name || q.guest_description}</div>
                          <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)' }}>
                            {q.member_name || q.guest_phone || ''}
                            {q.estimated_litres ? ` · ~${q.estimated_litres}L` : ''}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {q.fuel_type && <span className="badge badge-navy">{q.fuel_type}</span>}
                        <span className={`badge ${q.status === 'service' ? 'badge-teal' : q.status === 'next' ? 'badge-gold' : 'badge-gray'}`}>{q.status}</span>
                        {q.status !== 'completed' && (
                          <button className="btn btn-primary btn-sm" onClick={() => handleAdvance(q)}>
                            {NEXT_LABEL[q.status]}
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => removeEntry(q.id)} title="Remove from queue">
                          <Ic n="x" s={11} />
                        </button>
                      </div>
                    </div>
                    {completingId === q.id && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                        <CompletionForm
                          entry={q}
                          onComplete={handleComplete}
                          onCancel={() => setCompletingId(null)}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Operations() {
  const [tab, setTab] = useState('fueldock');

  return (
    <div>
      <div className="tabs">
        {[['fueldock', 'Fuel Dock']].map(([v, l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>
      {tab === 'fueldock' && <FuelDockTab />}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/screens/Operations.jsx
git commit -m "feat(frontend): add Operations screen with live Fuel Dock queue"
```

---

## Task 14: Wire Operations into App.jsx and Sidebar

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/layout/Sidebar.jsx`

- [ ] **Step 1: Add Operations to App.jsx**

In `frontend/src/App.jsx`, add the import and entry:

```jsx
import Operations from './screens/Operations.jsx';

const SCREEN_MAP = {
  overview:     Overview,
  map:          MarinaMap,
  reservations: Reservations,
  operations:   Operations,       // ← add this
  vessels:      Vessels,
  boatyard:     Boatyard,
  maintenance:  Maintenance,
  staff:        Staff,
  billing:      Billing,
  reports:      Reports,
  members:      Members,
  restaurant:   Restaurant,
  events:       Events,
  settings:     Settings,
  documents:    Documents,
  sales:        Sales,
};
```

- [ ] **Step 2: Add Operations to Sidebar nav**

In `frontend/src/components/layout/Sidebar.jsx`, add `operations` to the Operations group:

```javascript
const NAV = [
  { group: 'Operations', items: [
    { id: 'overview',     icon: 'grid',       label: 'Overview' },
    { id: 'map',          icon: 'map',        label: 'Marina Map' },
    { id: 'reservations', icon: 'calendar',   label: 'Reservations', count: 3 },
    { id: 'operations',   icon: 'zap',        label: 'Operations' },    // ← add this
    { id: 'vessels',      icon: 'ship',       label: 'Vessels' },
    { id: 'documents',    icon: 'clipboard',  label: 'Documents & eSign' },
  ]},
  // ... rest unchanged
```

- [ ] **Step 3: Verify in browser**

- Sidebar shows "Operations" nav item
- Clicking it loads the Operations screen with Fuel Dock tab
- Add to Queue works (try both Known Vessel and Free Text modes)
- Advance button moves entries through waiting → next → service
- Completing a service entry shows the litres/price form and removes the entry from the active queue

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx frontend/src/components/layout/Sidebar.jsx
git commit -m "feat(frontend): add Operations to nav and screen map"
```

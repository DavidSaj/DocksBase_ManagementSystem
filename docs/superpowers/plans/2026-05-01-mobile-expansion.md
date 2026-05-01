# Mobile App Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the Staff Field App (`/field`) into a full quick-action hub with 5 flows, and add My Berth and My Vessel tabs to the Boater Portal (`/portal`).

**Architecture:** The Field app gains a bottom tab bar shell with an action grid home and extracts the existing task list. Each action opens a self-contained flow screen that fetches its own data and returns to the grid on success. The Boater Portal adds two new tabs backed by two new DRF endpoints in the existing portal app. A new staff-facing CraneRequest endpoint is added alongside them.

**Tech Stack:** React 19 (inline styles matching existing Field.jsx aesthetic, `.portal-*` CSS classes matching existing BoaterPortal.jsx), Django DRF, existing `api.js` Axios instance, existing `useBookings` hook, existing `IsBoater` permission class.

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `backend/apps/reservations/views.py` | Modify | Override `BookingDetailView.perform_update` to finalize draft invoice on checkout |
| `backend/apps/portal/views.py` | Modify | Add `CraneRequestStaffListView`, `CraneRequestStaffDetailView`, `PortalBerthView`, `PortalVesselView` |
| `backend/apps/portal/serializers.py` | Modify | Add `CraneRequestStaffSerializer`, `PortalBerthSerializer`, `PortalVesselCertificateSerializer`, `PortalVesselSerializer` |
| `backend/apps/portal/urls.py` | Modify | Wire up 4 new URL patterns |
| `backend/apps/portal/tests.py` | Modify | Tests for all 4 new endpoints |
| `frontend/src/screens/field/TaskList.jsx` | Create | Exact copy of existing Field.jsx roster+detail+completion logic |
| `frontend/src/screens/field/CheckInFlow.jsx` | Create | List today's pending arrivals → tap → check in |
| `frontend/src/screens/field/CheckOutFlow.jsx` | Create | List checked-in bookings with sticky search → tap → check out |
| `frontend/src/screens/field/LogTaskFlow.jsx` | Create | Form to create a new MaintenanceTask |
| `frontend/src/screens/field/CraneApprovalFlow.jsx` | Create | List requested crane lifts → approve / reject |
| `frontend/src/screens/field/ArrivalsList.jsx` | Create | Read-only today+tomorrow arrivals |
| `frontend/src/screens/Field.jsx` | Modify | Becomes shell: bottom tab bar, Actions tab (grid), Tasks tab (TaskList) |
| `frontend/src/hooks/usePortalBerth.js` | Create | GET `/portal/berth/` |
| `frontend/src/hooks/usePortalVessel.js` | Create | GET `/portal/vessel/` |
| `frontend/src/screens/BoaterPortal.jsx` | Modify | Add Berth and Vessel tabs |

---

## Task 1: Backend — Checkout invoice finalisation

**Files:**
- Modify: `backend/apps/reservations/views.py` (class `BookingDetailView`, currently lines 53–58)
- Test: `backend/apps/reservations/tests.py`

- [ ] **Step 1: Write the failing test**

Open `backend/apps/reservations/tests.py` and add this test class after the existing ones:

```python
from apps.billing.models import Invoice, InvoiceLineItem
from apps.billing import service as billing_service

class CheckoutFinalisesInvoiceTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user   = make_user(self.marina)
        self.berth  = make_berth(self.marina, price=100)
        self.member = Member.objects.create(marina=self.marina, name='A. Smith')
        self.vessel = Vessel.objects.create(marina=self.marina, name='Blue Wave', owner=self.member)
        self.booking = Booking.objects.create(
            marina=self.marina, berth=self.berth, vessel=self.vessel,
            booking_type='transient', check_in='2026-06-01', check_out='2026-06-04',
            nights=3, amount=300, status='checked_in',
        )
        # Create a draft invoice linked to the booking
        self.invoice = Invoice.objects.create(
            marina=self.marina, member=self.member,
            source_type='berth_booking', source_id=str(self.booking.id),
            status='draft',
        )
        InvoiceLineItem.objects.create(
            invoice=self.invoice, description='Berth fee', quantity=1, unit_price=300,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_checkout_patch_finalises_draft_invoice(self):
        resp = self.client.patch(f'/api/v1/bookings/{self.booking.id}/', {'status': 'checked_out'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'open')

    def test_checkout_does_not_error_when_no_invoice(self):
        # Delete the invoice — checkout should still succeed
        self.invoice.delete()
        resp = self.client.patch(f'/api/v1/bookings/{self.booking.id}/', {'status': 'checked_out'}, format='json')
        self.assertEqual(resp.status_code, 200)
```

- [ ] **Step 2: Run test to confirm failure**

```
cd backend && python manage.py test apps.reservations.tests.CheckoutFinalisesInvoiceTest -v 2
```

Expected: FAIL — `test_checkout_patch_finalises_draft_invoice` fails because status remains `draft`.

- [ ] **Step 3: Override `perform_update` in `BookingDetailView`**

In `backend/apps/reservations/views.py`, replace:

```python
class BookingDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = BookingSerializer

    def get_queryset(self):
        return Booking.objects.filter(marina=self.request.user.marina)
```

with:

```python
class BookingDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = BookingSerializer

    def get_queryset(self):
        return Booking.objects.filter(marina=self.request.user.marina)

    def perform_update(self, serializer):
        instance = serializer.save()
        if instance.status == 'checked_out':
            from apps.billing.models import Invoice as InvoiceModel
            draft = InvoiceModel.objects.filter(
                marina=self.request.user.marina,
                source_type='berth_booking',
                source_id=str(instance.id),
                status='draft',
            ).first()
            if draft:
                billing_service.finalize_invoice(draft)
```

- [ ] **Step 4: Run tests to confirm pass**

```
cd backend && python manage.py test apps.reservations.tests.CheckoutFinalisesInvoiceTest -v 2
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/reservations/views.py backend/apps/reservations/tests.py
git commit -m "feat: finalise draft invoice when booking is checked out"
```

---

## Task 2: Backend — Staff crane request endpoints

**Files:**
- Modify: `backend/apps/portal/serializers.py`
- Modify: `backend/apps/portal/views.py`
- Modify: `backend/apps/portal/urls.py`
- Modify: `backend/apps/portal/tests.py`

- [ ] **Step 1: Write the failing tests**

Open `backend/apps/portal/tests.py` and replace its contents entirely:

```python
import datetime
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.members.models import Member
from apps.vessels.models import Vessel, VesselCertificate
from apps.reservations.models import Booking
from apps.berths.models import Pier, Berth
from .models import CraneRequest


def make_marina():
    return Marina.objects.create(name='Test Marina', contact_email='marina@test.com')

def make_staff(marina):
    return User.objects.create_user(email='staff@test.com', password='pass', marina=marina, role='staff')

def make_boater(marina, member):
    return User.objects.create_user(
        email='boater@test.com', password='pass', marina=marina, role='boater',
        member_profile=member,
    )

def make_member(marina):
    return Member.objects.create(marina=marina, name='J. Sailor', email='j@sailor.com')


class CraneStaffListTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.staff  = make_staff(self.marina)
        self.member = make_member(self.marina)
        CraneRequest.objects.create(member=self.member, service_type='haul_out', requested_date='2026-06-01', status='requested')
        CraneRequest.objects.create(member=self.member, service_type='launch',   requested_date='2026-06-02', status='approved')
        self.client = APIClient()
        self.client.force_authenticate(user=self.staff)

    def test_staff_can_list_all_crane_requests(self):
        resp = self.client.get('/api/v1/portal/crane-requests/staff/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 2)

    def test_staff_can_filter_by_status(self):
        resp = self.client.get('/api/v1/portal/crane-requests/staff/?status=requested')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 1)

    def test_staff_can_approve(self):
        req = CraneRequest.objects.filter(status='requested').first()
        resp = self.client.patch(f'/api/v1/portal/crane-requests/{req.id}/staff-update/', {'status': 'approved'}, format='json')
        self.assertEqual(resp.status_code, 200)
        req.refresh_from_db()
        self.assertEqual(req.status, 'approved')

    def test_staff_can_reject(self):
        req = CraneRequest.objects.filter(status='requested').first()
        resp = self.client.patch(f'/api/v1/portal/crane-requests/{req.id}/staff-update/', {'status': 'rejected'}, format='json')
        self.assertEqual(resp.status_code, 200)
        req.refresh_from_db()
        self.assertEqual(req.status, 'rejected')
```

- [ ] **Step 2: Run tests to confirm failure**

```
cd backend && python manage.py test apps.portal.tests.CraneStaffListTest -v 2
```

Expected: FAIL — 404 on `/api/v1/portal/crane-requests/staff/`.

- [ ] **Step 3: Add `CraneRequestStaffSerializer` to `portal/serializers.py`**

In `backend/apps/portal/serializers.py`, append:

```python
class CraneRequestStaffSerializer(serializers.ModelSerializer):
    member_name = serializers.CharField(source='member.name', read_only=True)

    class Meta:
        model = CraneRequest
        fields = ['id', 'member_name', 'service_type', 'requested_date', 'notes', 'status', 'created_at']
        read_only_fields = ['id', 'member_name', 'service_type', 'requested_date', 'notes', 'created_at']
```

- [ ] **Step 4: Add staff views to `portal/views.py`**

In `backend/apps/portal/views.py`, add at the top of the imports:
```python
from rest_framework.permissions import IsAuthenticated
```

Then append these two views at the bottom of the file:

```python
from .serializers import CraneRequestStaffSerializer

class CraneRequestStaffListView(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = CraneRequestStaffSerializer

    def get_queryset(self):
        qs = CraneRequest.objects.filter(
            member__marina=self.request.user.marina
        ).select_related('member').order_by('-created_at')
        status = self.request.query_params.get('status')
        if status:
            qs = qs.filter(status=status)
        return qs


class CraneRequestStaffDetailView(generics.UpdateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = CraneRequestStaffSerializer

    def get_queryset(self):
        return CraneRequest.objects.filter(member__marina=self.request.user.marina)
```

- [ ] **Step 5: Add URL patterns to `portal/urls.py`**

Replace `backend/apps/portal/urls.py` contents:

```python
from django.urls import path
from .views import (
    PortalInvoiceListView, AbsenceReportCreateView, CraneRequestListCreateView,
    CraneRequestStaffListView, CraneRequestStaffDetailView,
)

urlpatterns = [
    path('portal/invoices/',                              PortalInvoiceListView.as_view(),         name='portal_invoices'),
    path('portal/absence/',                               AbsenceReportCreateView.as_view(),       name='portal_absence'),
    path('portal/crane-requests/',                        CraneRequestListCreateView.as_view(),    name='portal_crane_requests'),
    path('portal/crane-requests/staff/',                  CraneRequestStaffListView.as_view(),     name='portal_crane_staff_list'),
    path('portal/crane-requests/<int:pk>/staff-update/',  CraneRequestStaffDetailView.as_view(),   name='portal_crane_staff_detail'),
]
```

- [ ] **Step 6: Run tests to confirm pass**

```
cd backend && python manage.py test apps.portal.tests.CraneStaffListTest -v 2
```

Expected: 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/portal/serializers.py backend/apps/portal/views.py backend/apps/portal/urls.py backend/apps/portal/tests.py
git commit -m "feat: add staff-facing crane request list and approve/reject endpoints"
```

---

## Task 3: Backend — PortalBerthView

**Files:**
- Modify: `backend/apps/portal/serializers.py`
- Modify: `backend/apps/portal/views.py`
- Modify: `backend/apps/portal/urls.py`
- Modify: `backend/apps/portal/tests.py`

- [ ] **Step 1: Write the failing test**

In `backend/apps/portal/tests.py`, add this class after `CraneStaffListTest`:

```python
class PortalBerthTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.boater = make_boater(self.marina, self.member)
        self.vessel = Vessel.objects.create(marina=self.marina, name='Blue Wave', owner=self.member)
        pier = Pier.objects.create(marina=self.marina, code='A', label='Pier A')
        berth = Berth.objects.create(marina=self.marina, pier=pier, code='A1', status='available')
        self.booking = Booking.objects.create(
            marina=self.marina, berth=berth, vessel=self.vessel,
            booking_type='transient', check_in='2026-06-01', check_out='2026-06-07',
            nights=6, status='checked_in',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.boater)

    def test_boater_sees_active_booking(self):
        resp = self.client.get('/api/v1/portal/berth/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['berth_code'], 'A1')
        self.assertEqual(data[0]['pier_label'], 'Pier A')
        self.assertEqual(data[0]['status'], 'checked_in')

    def test_boater_sees_empty_when_no_bookings(self):
        self.booking.delete()
        resp = self.client.get('/api/v1/portal/berth/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_staff_cannot_access_berth_portal(self):
        staff = make_staff(self.marina)
        self.client.force_authenticate(user=staff)
        resp = self.client.get('/api/v1/portal/berth/')
        self.assertEqual(resp.status_code, 403)
```

Note: `make_boater` requires a `member_profile` argument on `User`. Check the `User` model for the correct field name — it may be `member_profile` (OneToOneField). If the field name differs, adjust the factory accordingly.

- [ ] **Step 2: Run tests to confirm failure**

```
cd backend && python manage.py test apps.portal.tests.PortalBerthTest -v 2
```

Expected: FAIL — 404 on `/api/v1/portal/berth/`.

- [ ] **Step 3: Add `PortalBerthSerializer` to `portal/serializers.py`**

First add this import at the top of `portal/serializers.py`:
```python
import datetime
```

Then append after `CraneRequestStaffSerializer`:

```python
from apps.reservations.models import Booking

class PortalBerthSerializer(serializers.ModelSerializer):
    berth_code = serializers.SerializerMethodField()
    pier_label = serializers.SerializerMethodField()
    nights_remaining = serializers.SerializerMethodField()

    def get_berth_code(self, obj):
        return obj.berth.code if obj.berth else None

    def get_pier_label(self, obj):
        if not obj.berth:
            return None
        pier = obj.berth.pier
        return pier.label or pier.code

    def get_nights_remaining(self, obj):
        if not obj.check_out:
            return None
        remaining = (obj.check_out - datetime.date.today()).days
        return max(remaining, 0)

    class Meta:
        model = Booking
        fields = ['id', 'berth_code', 'pier_label', 'check_in', 'check_out', 'nights_remaining', 'status']
```

- [ ] **Step 4: Add `PortalBerthView` to `portal/views.py`**

Add this import near the top of `portal/views.py`:
```python
from apps.reservations.models import Booking
```

Append at the bottom of the file:

```python
from .serializers import PortalBerthSerializer

class PortalBerthView(generics.ListAPIView):
    permission_classes = [IsBoater]
    serializer_class = PortalBerthSerializer

    def get_queryset(self):
        member = self.request.user.member_profile
        return Booking.objects.filter(
            vessel__owner=member,
            marina=self.request.user.marina,
            status__in=['checked_in', 'pending'],
        ).select_related('berth__pier').order_by('-check_in')
```

- [ ] **Step 5: Add URL to `portal/urls.py`**

Add `PortalBerthView` to the imports line and add the path:

```python
from django.urls import path
from .views import (
    PortalInvoiceListView, AbsenceReportCreateView, CraneRequestListCreateView,
    CraneRequestStaffListView, CraneRequestStaffDetailView,
    PortalBerthView,
)

urlpatterns = [
    path('portal/invoices/',                              PortalInvoiceListView.as_view(),         name='portal_invoices'),
    path('portal/absence/',                               AbsenceReportCreateView.as_view(),       name='portal_absence'),
    path('portal/crane-requests/',                        CraneRequestListCreateView.as_view(),    name='portal_crane_requests'),
    path('portal/crane-requests/staff/',                  CraneRequestStaffListView.as_view(),     name='portal_crane_staff_list'),
    path('portal/crane-requests/<int:pk>/staff-update/',  CraneRequestStaffDetailView.as_view(),   name='portal_crane_staff_detail'),
    path('portal/berth/',                                 PortalBerthView.as_view(),               name='portal_berth'),
]
```

- [ ] **Step 6: Check the User model for `member_profile` field name**

Run:
```
cd backend && python manage.py shell -c "from apps.accounts.models import User; print([f.name for f in User._meta.get_fields() if 'member' in f.name.lower()])"
```

If the field name is different from `member_profile`, update `make_boater` in the test and the `IsBoater` permission check. The `IsBoater` class already uses `request.user.member_profile` so the field must exist; this step just confirms the test factory is using the right name.

- [ ] **Step 7: Run tests to confirm pass**

```
cd backend && python manage.py test apps.portal.tests.PortalBerthTest -v 2
```

Expected: 3 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/apps/portal/serializers.py backend/apps/portal/views.py backend/apps/portal/urls.py backend/apps/portal/tests.py
git commit -m "feat: add portal berth endpoint for boater active/upcoming bookings"
```

---

## Task 4: Backend — PortalVesselView

**Files:**
- Modify: `backend/apps/portal/serializers.py`
- Modify: `backend/apps/portal/views.py`
- Modify: `backend/apps/portal/urls.py`
- Modify: `backend/apps/portal/tests.py`

- [ ] **Step 1: Write the failing test**

In `backend/apps/portal/tests.py`, add after `PortalBerthTest`:

```python
class PortalVesselTest(TestCase):
    def setUp(self):
        self.marina = make_marina()   # contact_email='marina@test.com'
        self.member = make_member(self.marina)
        self.boater = make_boater(self.marina, self.member)
        self.vessel = Vessel.objects.create(marina=self.marina, name='Blue Wave', owner=self.member,
                                            vessel_type='sail', loa='12.50', beam='3.80', reg='UK1234')
        VesselCertificate.objects.create(
            marina=self.marina, vessel=self.vessel, name='Registration',
            cert_type='registration', expires=datetime.date.today() + datetime.timedelta(days=200),
        )
        VesselCertificate.objects.create(
            marina=self.marina, vessel=self.vessel, name='VHF Licence',
            cert_type='vhf', expires=datetime.date.today() + datetime.timedelta(days=15),
        )
        VesselCertificate.objects.create(
            marina=self.marina, vessel=self.vessel, name='Insurance',
            cert_type='other', expires=datetime.date.today() - datetime.timedelta(days=5),
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.boater)

    def test_boater_sees_vessel_and_certificates(self):
        resp = self.client.get('/api/v1/portal/vessel/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['name'], 'Blue Wave')
        self.assertEqual(data['reg'], 'UK1234')
        self.assertEqual(len(data['certificates']), 3)

    def test_certificate_status_computed_correctly(self):
        resp = self.client.get('/api/v1/portal/vessel/')
        certs = {c['name']: c['cert_status'] for c in resp.json()['certificates']}
        self.assertEqual(certs['Registration'], 'valid')
        self.assertEqual(certs['VHF Licence'], 'due_soon')
        self.assertEqual(certs['Insurance'], 'expired')

    def test_marina_contact_email_included(self):
        resp = self.client.get('/api/v1/portal/vessel/')
        self.assertEqual(resp.json()['marina_contact_email'], 'marina@test.com')

    def test_returns_404_when_no_vessel(self):
        self.vessel.delete()
        resp = self.client.get('/api/v1/portal/vessel/')
        self.assertEqual(resp.status_code, 404)
```

- [ ] **Step 2: Run tests to confirm failure**

```
cd backend && python manage.py test apps.portal.tests.PortalVesselTest -v 2
```

Expected: FAIL — 404 on `/api/v1/portal/vessel/`.

- [ ] **Step 3: Add vessel serializers to `portal/serializers.py`**

Append after `PortalBerthSerializer`:

```python
from apps.vessels.models import Vessel, VesselCertificate


class PortalVesselCertificateSerializer(serializers.ModelSerializer):
    cert_status = serializers.SerializerMethodField()

    def get_cert_status(self, obj):
        if not obj.expires:
            return 'valid'
        today = datetime.date.today()
        if obj.expires < today:
            return 'expired'
        if (obj.expires - today).days <= 30:
            return 'due_soon'
        return 'valid'

    class Meta:
        model = VesselCertificate
        fields = ['id', 'name', 'cert_type', 'expires', 'cert_status']


class PortalVesselSerializer(serializers.ModelSerializer):
    certificates = PortalVesselCertificateSerializer(many=True, read_only=True)
    marina_contact_email = serializers.SerializerMethodField()

    def get_marina_contact_email(self, obj):
        return self.context['request'].user.marina.contact_email

    class Meta:
        model = Vessel
        fields = ['id', 'name', 'vessel_type', 'loa', 'beam', 'reg', 'flag', 'marina_contact_email', 'certificates']
```

- [ ] **Step 4: Add `PortalVesselView` to `portal/views.py`**

Add this import near the top of `portal/views.py`:
```python
from rest_framework.exceptions import NotFound
from apps.vessels.models import Vessel
```

Append at the bottom:

```python
from .serializers import PortalVesselSerializer

class PortalVesselView(generics.RetrieveAPIView):
    permission_classes = [IsBoater]
    serializer_class = PortalVesselSerializer

    def get_object(self):
        member = self.request.user.member_profile
        vessel = (
            Vessel.objects
            .filter(owner=member, marina=self.request.user.marina)
            .prefetch_related('certificates')
            .first()
        )
        if vessel is None:
            raise NotFound('No vessel on file.')
        return vessel
```

- [ ] **Step 5: Add URL to `portal/urls.py`**

```python
from django.urls import path
from .views import (
    PortalInvoiceListView, AbsenceReportCreateView, CraneRequestListCreateView,
    CraneRequestStaffListView, CraneRequestStaffDetailView,
    PortalBerthView, PortalVesselView,
)

urlpatterns = [
    path('portal/invoices/',                              PortalInvoiceListView.as_view(),         name='portal_invoices'),
    path('portal/absence/',                               AbsenceReportCreateView.as_view(),       name='portal_absence'),
    path('portal/crane-requests/',                        CraneRequestListCreateView.as_view(),    name='portal_crane_requests'),
    path('portal/crane-requests/staff/',                  CraneRequestStaffListView.as_view(),     name='portal_crane_staff_list'),
    path('portal/crane-requests/<int:pk>/staff-update/',  CraneRequestStaffDetailView.as_view(),   name='portal_crane_staff_detail'),
    path('portal/berth/',                                 PortalBerthView.as_view(),               name='portal_berth'),
    path('portal/vessel/',                                PortalVesselView.as_view(),              name='portal_vessel'),
]
```

- [ ] **Step 6: Run tests to confirm pass**

```
cd backend && python manage.py test apps.portal.tests.PortalVesselTest -v 2
```

Expected: 4 tests PASS.

- [ ] **Step 7: Run full portal test suite**

```
cd backend && python manage.py test apps.portal -v 2
```

Expected: All tests PASS (CraneStaffListTest + PortalBerthTest + PortalVesselTest).

- [ ] **Step 8: Commit**

```bash
git add backend/apps/portal/serializers.py backend/apps/portal/views.py backend/apps/portal/urls.py backend/apps/portal/tests.py
git commit -m "feat: add portal vessel endpoint with dynamic certificate status"
```

---

## Task 5: Frontend — Extract TaskList.jsx

**Files:**
- Create: `frontend/src/screens/field/TaskList.jsx`
- Modify: `frontend/src/screens/Field.jsx` (temporarily, will be fully replaced in Task 11)

- [ ] **Step 1: Create the `field/` directory and `TaskList.jsx`**

Create `frontend/src/screens/field/TaskList.jsx` with this content (exact copy of the three-screen logic currently in `Field.jsx`):

```jsx
import { useState } from 'react';
import useMaintenanceTasks from '../../hooks/useMaintenanceTasks.js';

const PRIORITY_LABEL = { urgent: '🔥 Urgent', high: '🔥 High', medium: '🟠 Medium', low: '⬜ Low' };
const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };

const ACTION_BTN = {
  width: '100%', height: 60, borderRadius: 12,
  background: '#1a2d4a', color: '#fff',
  border: 'none', fontSize: 17, fontWeight: 700,
  cursor: 'pointer',
};

const PINNED = {
  position: 'fixed', bottom: 0, left: 0, right: 0,
  padding: '12px 20px 28px', background: '#fff',
  borderTop: '1px solid rgba(0,0,0,0.1)',
};

export default function TaskList() {
  const { tasks, loading, updateTask, completeTask } = useMaintenanceTasks();
  const [selectedId, setSelectedId]         = useState(null);
  const [showCompletion, setShowCompletion]  = useState(false);
  const [completionNotes, setCompletionNotes] = useState('');
  const [completionPhoto, setCompletionPhoto] = useState(null);
  const [submitting, setSubmitting]          = useState(false);

  const activeTasks = tasks
    .filter(t => t.status !== 'completed')
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9));

  const selected = tasks.find(t => t.id === selectedId);

  async function handleStart() {
    await updateTask(selected.id, { status: 'in_progress' });
  }

  async function handleSubmitCompletion() {
    setSubmitting(true);
    try {
      await completeTask(selected.id, completionNotes, completionPhoto);
      setShowCompletion(false);
      setSelectedId(null);
      setCompletionNotes('');
      setCompletionPhoto(null);
    } finally {
      setSubmitting(false);
    }
  }

  if (showCompletion && selected) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
        <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: '24px 20px 0' }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Complete Task</div>
          <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 20 }}>{selected.title}</div>
          <textarea
            value={completionNotes}
            onChange={e => setCompletionNotes(e.target.value)}
            placeholder="Add a completion note…"
            style={{ width: '100%', minHeight: 100, padding: 14, fontSize: 15, borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.15)', resize: 'none', boxSizing: 'border-box', marginBottom: 14 }}
          />
          <label style={{ display: 'block', width: '100%', height: 52, lineHeight: '52px', textAlign: 'center', background: '#f4f6f8', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer', marginBottom: 20 }}>
            📷 {completionPhoto ? completionPhoto.name : 'Add Photo'}
            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => setCompletionPhoto(e.target.files[0] || null)} />
          </label>
          <button style={{ ...ACTION_BTN, marginBottom: 12 }} disabled={submitting} onClick={handleSubmitCompletion}>
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
          <button style={{ width: '100%', height: 48, background: 'transparent', border: 'none', fontSize: 15, color: 'rgba(0,0,0,0.5)', cursor: 'pointer', marginBottom: 16 }} onClick={() => setShowCompletion(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <div style={{ minHeight: '100vh', background: '#f4f6f8', paddingBottom: 100 }}>
        <div style={{ background: '#fff', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
          <button onClick={() => setSelectedId(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', padding: 0, lineHeight: 1, minWidth: 44, minHeight: 44 }}>←</button>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Task Detail</div>
        </div>
        <div style={{ padding: '20px 20px 0' }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, lineHeight: 1.3 }}>{selected.title}</div>
          {selected.asset_name && <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 12 }}>{selected.asset_name}</div>}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ padding: '4px 12px', borderRadius: 20, background: '#1a2d4a', color: '#fff', fontSize: 12, fontWeight: 700 }}>
              {PRIORITY_LABEL[selected.priority] ?? selected.priority}
            </span>
            <span style={{ padding: '4px 12px', borderRadius: 20, background: '#e8ecf0', color: 'rgba(0,0,0,0.6)', fontSize: 12 }}>
              {selected.status.replace('_', ' ')}
            </span>
          </div>
          {selected.description && (
            <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.65)', lineHeight: 1.65, background: '#fff', borderRadius: 12, padding: 16, marginBottom: 14 }}>
              {selected.description}
            </div>
          )}
          {selected.due_date && <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 8 }}>Due: <b>{selected.due_date}</b></div>}
          {selected.assigned_to && <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)' }}>Assigned: <b>{selected.assigned_to}</b></div>}
        </div>
        <div style={PINNED}>
          {selected.status === 'pending'     && <button style={ACTION_BTN} onClick={handleStart}>▶ START TASK</button>}
          {selected.status === 'in_progress' && <button style={ACTION_BTN} onClick={() => setShowCompletion(true)}>✔ MARK DONE</button>}
          {selected.status === 'blocked'     && <div style={{ textAlign: 'center', fontSize: 15, color: 'rgba(0,0,0,0.4)', fontWeight: 600, padding: '18px 0' }}>Blocked — contact manager</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={{ background: '#1a2d4a', padding: '20px 20px 16px', color: '#fff' }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>My Tasks</div>
        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 2 }}>{activeTasks.length} active</div>
      </div>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
      ) : (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {activeTasks.map(t => (
            <div key={t.id} onClick={() => setSelectedId(t.id)}
              style={{ background: '#fff', borderRadius: 14, padding: 18, minHeight: 60, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t.title}</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 8 }}>
                {[t.asset_name, t.assigned_to].filter(Boolean).join(' · ')}
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: (t.priority === 'urgent' || t.priority === 'high') ? '#c0392b' : t.priority === 'medium' ? '#e67e22' : 'rgba(0,0,0,0.4)' }}>
                {PRIORITY_LABEL[t.priority] ?? t.priority}
              </span>
            </div>
          ))}
          {activeTasks.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: 'rgba(0,0,0,0.35)' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>✓</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>All done!</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>No active tasks.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the file renders by importing it in the browser**

Open the dev server (`npm run dev` in `frontend/`) and navigate to `/field`. Confirm the task list still shows (Field.jsx hasn't changed yet — this step is just file creation).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/screens/field/TaskList.jsx
git commit -m "feat: extract TaskList into field/TaskList.jsx"
```

---

## Task 6: Frontend — CheckInFlow.jsx

**Files:**
- Create: `frontend/src/screens/field/CheckInFlow.jsx`

This screen lists today's bookings with `status=pending`, fetched from `GET /api/v1/bookings/?status=pending`. Today's arrivals are filtered client-side by `check_in === today`. Tapping a booking shows a detail card; the "Check In" button PATCHes `status: 'checked_in'` and `actual_arrival: todayStr` (if the model has that field — PATCH only `status` if `actual_arrival` doesn't exist).

- [ ] **Step 1: Create `CheckInFlow.jsx`**

```jsx
import { useState, useEffect } from 'react';
import api from '../../api.js';

const HDR = { background: '#1a2d4a', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44 };
const CARD = { background: '#fff', borderRadius: 14, padding: 18, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' };
const ACTION_BTN = { width: '100%', height: 60, borderRadius: 12, background: '#1a2d4a', color: '#fff', border: 'none', fontSize: 17, fontWeight: 700, cursor: 'pointer' };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function CheckInFlow({ onBack }) {
  const [bookings, setBookings]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(null);
  const [saving, setSaving]       = useState(false);
  const [done, setDone]           = useState(false);

  useEffect(() => {
    api.get('/bookings/', { params: { status: 'pending' } })
      .then(r => {
        const today = todayStr();
        const data = r.data.results ?? r.data;
        setBookings(data.filter(b => b.check_in === today));
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleCheckIn() {
    setSaving(true);
    try {
      await api.patch(`/bookings/${selected.id}/`, { status: 'checked_in' });
      setDone(true);
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
        <div style={HDR}>
          <button style={BACK_BTN} onClick={onBack}>←</button>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Check In</span>
        </div>
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Checked In</div>
          <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.5)', marginBottom: 28 }}>{selected?.vessel_name || selected?.guest_name}</div>
          <button style={ACTION_BTN} onClick={onBack}>Back to Actions</button>
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
        <div style={HDR}>
          <button style={BACK_BTN} onClick={() => setSelected(null)}>←</button>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Check In</span>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ ...CARD, cursor: 'default', marginBottom: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{selected.vessel_name || selected.guest_name}</div>
            {selected.berth_code && <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Berth {selected.berth_code}</div>}
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Arriving: {selected.check_in}</div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)' }}>Departing: {selected.check_out}</div>
          </div>
          <button style={ACTION_BTN} disabled={saving} onClick={handleCheckIn}>
            {saving ? 'Saving…' : '✅ Check In'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={HDR}>
        <button style={BACK_BTN} onClick={onBack}>←</button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Today's Arrivals</span>
      </div>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
      ) : bookings.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚓</div>
          <div style={{ fontSize: 15 }}>No pending arrivals today.</div>
        </div>
      ) : (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {bookings.map(b => (
            <div key={b.id} style={CARD} onClick={() => setSelected(b)}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{b.vessel_name || b.guest_name}</div>
              {b.berth_code && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>Berth {b.berth_code}</div>}
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{b.check_in} → {b.check_out}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

Note: `vessel_name`, `guest_name`, `berth_code` are the field names returned by `BookingSerializer`. Verify these by running `GET /api/v1/bookings/?status=pending` in the browser after the dev server is running and checking the JSON response. Adjust field names if they differ (e.g. `vessel_name` might be nested as `vessel.name`).

- [ ] **Step 2: Commit**

```bash
git add frontend/src/screens/field/CheckInFlow.jsx
git commit -m "feat: add CheckInFlow screen for mobile staff check-in"
```

---

## Task 7: Frontend — CheckOutFlow.jsx

**Files:**
- Create: `frontend/src/screens/field/CheckOutFlow.jsx`

Fetches all `checked_in` bookings. Sticky search bar at top filters locally by vessel name or berth code. Tapping → detail → "Check Out" → PATCH `status: 'checked_out'`.

- [ ] **Step 1: Create `CheckOutFlow.jsx`**

```jsx
import { useState, useEffect } from 'react';
import api from '../../api.js';

const HDR = { background: '#1a2d4a', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44 };
const ACTION_BTN = { width: '100%', height: 60, borderRadius: 12, background: '#1a2d4a', color: '#fff', border: 'none', fontSize: 17, fontWeight: 700, cursor: 'pointer' };

export default function CheckOutFlow({ onBack }) {
  const [allBookings, setAllBookings] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [selected, setSelected]       = useState(null);
  const [saving, setSaving]           = useState(false);
  const [checkedOut, setCheckedOut]   = useState(null);

  useEffect(() => {
    api.get('/bookings/', { params: { status: 'checked_in' } })
      .then(r => setAllBookings(r.data.results ?? r.data))
      .finally(() => setLoading(false));
  }, []);

  const filtered = allBookings.filter(b => {
    const q = search.toLowerCase();
    if (!q) return true;
    const vesselMatch = (b.vessel_name || b.guest_name || '').toLowerCase().includes(q);
    const berthMatch  = (b.berth_code || '').toLowerCase().includes(q);
    return vesselMatch || berthMatch;
  });

  async function handleCheckOut() {
    setSaving(true);
    try {
      const { data } = await api.patch(`/bookings/${selected.id}/`, { status: 'checked_out' });
      setCheckedOut(data);
      setAllBookings(prev => prev.filter(b => b.id !== selected.id));
    } finally {
      setSaving(false);
    }
  }

  if (checkedOut) {
    return (
      <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
        <div style={HDR}>
          <button style={BACK_BTN} onClick={onBack}>←</button>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Check Out</span>
        </div>
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🚪</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Checked Out</div>
          <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>{selected?.vessel_name || selected?.guest_name}</div>
          {checkedOut.amount && (
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1a2d4a', marginBottom: 28 }}>
              Invoice: €{Number(checkedOut.amount).toFixed(2)}
            </div>
          )}
          <button style={ACTION_BTN} onClick={onBack}>Back to Actions</button>
        </div>
      </div>
    );
  }

  if (selected) {
    const nights = selected.nights || '—';
    return (
      <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
        <div style={HDR}>
          <button style={BACK_BTN} onClick={() => setSelected(null)}>←</button>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Check Out</span>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 18, marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{selected.vessel_name || selected.guest_name}</div>
            {selected.berth_code && <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Berth {selected.berth_code}</div>}
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Arrived: {selected.check_in}</div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Departs: {selected.check_out}</div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>Nights: {nights}</div>
            {selected.amount && (
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1a2d4a', marginTop: 8 }}>
                Amount: €{Number(selected.amount).toFixed(2)}
              </div>
            )}
          </div>
          <button style={ACTION_BTN} disabled={saving} onClick={handleCheckOut}>
            {saving ? 'Saving…' : '🚪 Check Out'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={HDR}>
        <button style={BACK_BTN} onClick={onBack}>←</button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Check Out</span>
      </div>

      {/* Sticky search */}
      <div style={{ position: 'sticky', top: 0, background: '#fff', padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.08)', zIndex: 10 }}>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search vessel or berth…"
          style={{ width: '100%', height: 40, padding: '0 14px', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.15)', fontSize: 15, boxSizing: 'border-box' }}
        />
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚓</div>
          <div style={{ fontSize: 15 }}>{search ? 'No matches.' : 'No vessels checked in.'}</div>
        </div>
      ) : (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(b => (
            <div key={b.id}
              onClick={() => setSelected(b)}
              style={{ background: '#fff', borderRadius: 14, padding: 18, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{b.vessel_name || b.guest_name}</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                {[b.berth_code ? `Berth ${b.berth_code}` : null, b.check_in].filter(Boolean).join(' · ')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/screens/field/CheckOutFlow.jsx
git commit -m "feat: add CheckOutFlow with sticky search bar"
```

---

## Task 8: Frontend — LogTaskFlow.jsx

**Files:**
- Create: `frontend/src/screens/field/LogTaskFlow.jsx`

Posts to `POST /api/v1/maintenance/maintenance-tasks/` with `title`, `priority`, `description`. On success shows a toast-style confirmation and calls `onBack`.

- [ ] **Step 1: Create `LogTaskFlow.jsx`**

```jsx
import { useState } from 'react';
import api from '../../api.js';

const HDR = { background: '#1a2d4a', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44 };
const FIELD = { marginBottom: 16 };
const LABEL = { fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.55)', marginBottom: 6, display: 'block' };
const INPUT = { width: '100%', padding: '12px 14px', borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.15)', fontSize: 15, boxSizing: 'border-box', fontFamily: 'inherit' };
const ACTION_BTN = { width: '100%', height: 60, borderRadius: 12, background: '#1a2d4a', color: '#fff', border: 'none', fontSize: 17, fontWeight: 700, cursor: 'pointer' };

export default function LogTaskFlow({ onBack }) {
  const [form, setForm]         = useState({ title: '', priority: 'medium', description: '' });
  const [submitting, setSub]    = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState(false);

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required.'); return; }
    setError('');
    setSub(true);
    try {
      await api.post('/maintenance/maintenance-tasks/', form);
      setSuccess(true);
      setTimeout(onBack, 1200);
    } catch {
      setError('Could not save. Please try again.');
    } finally {
      setSub(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={HDR}>
        <button style={BACK_BTN} onClick={onBack}>←</button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Log Task</span>
      </div>

      {success ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔧</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Task logged!</div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ padding: 20 }}>
          <div style={FIELD}>
            <label style={LABEL}>Title *</label>
            <input style={INPUT} value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Fix gate latch on Pier A" />
          </div>
          <div style={FIELD}>
            <label style={LABEL}>Priority</label>
            <select style={INPUT} value={form.priority} onChange={e => set('priority', e.target.value)}>
              <option value="urgent">🔥 Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div style={FIELD}>
            <label style={LABEL}>Notes <span style={{ fontWeight: 400, color: 'rgba(0,0,0,0.35)' }}>(optional)</span></label>
            <textarea style={{ ...INPUT, minHeight: 80, resize: 'none' }} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Any extra detail…" />
          </div>
          {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <button type="submit" style={ACTION_BTN} disabled={submitting}>
            {submitting ? 'Saving…' : 'Log Task'}
          </button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/screens/field/LogTaskFlow.jsx
git commit -m "feat: add LogTaskFlow for quick mobile task creation"
```

---

## Task 9: Frontend — CraneApprovalFlow.jsx

**Files:**
- Create: `frontend/src/screens/field/CraneApprovalFlow.jsx`

Fetches `GET /api/v1/portal/crane-requests/staff/?status=requested`. Shows each request card with Approve / Reject buttons that PATCH the status and optimistically update the list.

- [ ] **Step 1: Create `CraneApprovalFlow.jsx`**

```jsx
import { useState, useEffect } from 'react';
import api from '../../api.js';

const HDR = { background: '#1a2d4a', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44 };

const SERVICE_LABEL = { launch: 'Launch', haul_out: 'Haul-out', both: 'Launch & Haul-out' };

export default function CraneApprovalFlow({ onBack }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [acting, setActing]     = useState(null); // id of request being acted on

  useEffect(() => {
    api.get('/portal/crane-requests/staff/', { params: { status: 'requested' } })
      .then(r => setRequests(r.data.results ?? r.data))
      .finally(() => setLoading(false));
  }, []);

  async function handleAction(id, newStatus) {
    setActing(id);
    try {
      await api.patch(`/portal/crane-requests/${id}/staff-update/`, { status: newStatus });
      setRequests(prev => prev.filter(r => r.id !== id));
    } finally {
      setActing(null);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={HDR}>
        <button style={BACK_BTN} onClick={onBack}>←</button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Crane Requests</span>
        {requests.length > 0 && (
          <span style={{ marginLeft: 'auto', background: '#d4b07a', color: '#1a2d4a', borderRadius: 12, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>
            {requests.length}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
      ) : requests.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🏗️</div>
          <div style={{ fontSize: 15 }}>No pending crane requests.</div>
        </div>
      ) : (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {requests.map(r => (
            <div key={r.id} style={{ background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{r.member_name}</div>
              <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 2 }}>{SERVICE_LABEL[r.service_type] || r.service_type}</div>
              <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: r.notes ? 8 : 12 }}>{r.requested_date}</div>
              {r.notes && <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.6)', marginBottom: 12 }}>{r.notes}</div>}
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  disabled={acting === r.id}
                  onClick={() => handleAction(r.id, 'approved')}
                  style={{ flex: 1, height: 44, borderRadius: 10, background: '#1a2d4a', color: '#fff', border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  ✅ Approve
                </button>
                <button
                  disabled={acting === r.id}
                  onClick={() => handleAction(r.id, 'rejected')}
                  style={{ flex: 1, height: 44, borderRadius: 10, background: '#f4f6f8', color: '#c0392b', border: '1.5px solid rgba(192,57,43,0.3)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  ✕ Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/screens/field/CraneApprovalFlow.jsx
git commit -m "feat: add CraneApprovalFlow for staff mobile approve/reject"
```

---

## Task 10: Frontend — ArrivalsList.jsx

**Files:**
- Create: `frontend/src/screens/field/ArrivalsList.jsx`

Read-only list of bookings arriving today and tomorrow. Fetches `status=pending` bookings and filters client-side by `check_in` being today or tomorrow.

- [ ] **Step 1: Create `ArrivalsList.jsx`**

```jsx
import { useState, useEffect } from 'react';
import api from '../../api.js';

const HDR = { background: '#1a2d4a', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44 };

function dateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const STATUS_COLOR = { pending: '#e67e22', checked_in: '#27ae60', confirmed: '#2980b9' };

export default function ArrivalsList({ onBack }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    api.get('/bookings/', { params: { status: 'pending' } })
      .then(r => {
        const today    = dateStr(0);
        const tomorrow = dateStr(1);
        const all = r.data.results ?? r.data;
        setBookings(all.filter(b => b.check_in === today || b.check_in === tomorrow));
      })
      .finally(() => setLoading(false));
  }, []);

  const today    = dateStr(0);
  const tomorrow = dateStr(1);
  const todayList    = bookings.filter(b => b.check_in === today);
  const tomorrowList = bookings.filter(b => b.check_in === tomorrow);

  function Section({ label, items }) {
    if (!items.length) return null;
    return (
      <>
        <div style={{ padding: '12px 16px 6px', fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)' }}>{label}</div>
        {items.map(b => (
          <div key={b.id} style={{ margin: '0 16px 10px', background: '#fff', borderRadius: 14, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>{b.vessel_name || b.guest_name}</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 6 }}>
              {[b.berth_code ? `Berth ${b.berth_code}` : null, `${b.check_in} → ${b.check_out}`].filter(Boolean).join(' · ')}
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: STATUS_COLOR[b.status] || '#ccc', color: '#fff' }}>
              {b.status}
            </span>
          </div>
        ))}
      </>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={HDR}>
        <button style={BACK_BTN} onClick={onBack}>←</button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Arrivals</span>
      </div>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
      ) : bookings.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🚢</div>
          <div style={{ fontSize: 15 }}>No arrivals today or tomorrow.</div>
        </div>
      ) : (
        <div style={{ paddingBottom: 24 }}>
          <Section label="Today" items={todayList} />
          <Section label="Tomorrow" items={tomorrowList} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/screens/field/ArrivalsList.jsx
git commit -m "feat: add ArrivalsList read-only screen for today/tomorrow arrivals"
```

---

## Task 11: Frontend — Refactor Field.jsx into shell

**Files:**
- Modify: `frontend/src/screens/Field.jsx`

Rewrite `Field.jsx` as a shell with a bottom tab bar. The **Actions** tab shows the 6-tile quick-action grid. The **Tasks** tab renders `<TaskList />`. Tapping an action tile renders the corresponding flow component. Tapping "My tasks" switches to the Tasks tab.

- [ ] **Step 1: Replace `Field.jsx` entirely**

```jsx
import { useState } from 'react';
import TaskList from './field/TaskList.jsx';
import CheckInFlow from './field/CheckInFlow.jsx';
import CheckOutFlow from './field/CheckOutFlow.jsx';
import LogTaskFlow from './field/LogTaskFlow.jsx';
import CraneApprovalFlow from './field/CraneApprovalFlow.jsx';
import ArrivalsList from './field/ArrivalsList.jsx';

const ACTIONS = [
  { id: 'checkin',   label: 'Check in vessel',   icon: '✅', badge: null },
  { id: 'checkout',  label: 'Check out vessel',  icon: '🚪', badge: null },
  { id: 'logtask',   label: 'Log task',           icon: '🔧', badge: null },
  { id: 'crane',     label: 'Approve crane',      icon: '🏗️', badge: null },
  { id: 'arrivals',  label: "Today's arrivals",   icon: '🚢', badge: null },
  { id: 'mytasks',   label: 'My tasks',           icon: '📋', badge: null },
];

function ActionGrid({ onSelect }) {
  return (
    <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {ACTIONS.map(a => (
        <button
          key={a.id}
          onClick={() => onSelect(a.id)}
          style={{
            background: '#fff', border: 'none', borderRadius: 16, padding: '20px 12px',
            cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            position: 'relative',
          }}
        >
          {a.badge !== null && (
            <span style={{
              position: 'absolute', top: 8, right: 8,
              background: '#c0392b', color: '#fff', borderRadius: 10, fontSize: 10, fontWeight: 700,
              padding: '1px 6px',
            }}>{a.badge}</span>
          )}
          <span style={{ fontSize: 28 }}>{a.icon}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1a2d4a', textAlign: 'center', lineHeight: 1.3 }}>{a.label}</span>
        </button>
      ))}
    </div>
  );
}

const TAB_BAR = {
  position: 'fixed', bottom: 0, left: 0, right: 0,
  background: '#fff', borderTop: '1px solid rgba(0,0,0,0.1)',
  display: 'flex', height: 60,
};

function TabBar({ tab, setTab }) {
  return (
    <div style={TAB_BAR}>
      {[{ id: 'actions', label: 'Actions', icon: '⚡' }, { id: 'tasks', label: 'Tasks', icon: '📋' }].map(t => (
        <button key={t.id} onClick={() => setTab(t.id)} style={{
          flex: 1, border: 'none', background: 'none', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
          color: tab === t.id ? '#1a2d4a' : 'rgba(0,0,0,0.35)',
          fontWeight: tab === t.id ? 700 : 400, fontSize: 11,
        }}>
          <span style={{ fontSize: 20 }}>{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export default function Field() {
  const [tab, setTab]       = useState('actions');
  const [flow, setFlow]     = useState(null); // null = grid, else action id

  function handleSelect(id) {
    if (id === 'mytasks') {
      setTab('tasks');
    } else {
      setFlow(id);
    }
  }

  function backToGrid() {
    setFlow(null);
    setTab('actions');
  }

  if (flow === 'checkin')  return <CheckInFlow onBack={backToGrid} />;
  if (flow === 'checkout') return <CheckOutFlow onBack={backToGrid} />;
  if (flow === 'logtask')  return <LogTaskFlow onBack={backToGrid} />;
  if (flow === 'crane')    return <CraneApprovalFlow onBack={backToGrid} />;
  if (flow === 'arrivals') return <ArrivalsList onBack={backToGrid} />;

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8', paddingBottom: 60 }}>
      <div style={{ background: '#1a2d4a', padding: '20px 20px 16px', color: '#fff' }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>DocksBase</div>
        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 2 }}>Field App</div>
      </div>

      {tab === 'actions' && <ActionGrid onSelect={handleSelect} />}
      {tab === 'tasks'   && <TaskList />}

      <TabBar tab={tab} setTab={setTab} />
    </div>
  );
}
```

- [ ] **Step 2: Verify in the browser**

With the dev server running, navigate to `/field`. Confirm:
- Header shows "DocksBase / Field App"
- 6-tile grid visible with icons and labels
- Bottom tab bar shows "Actions" and "Tasks"
- Tapping "My tasks" tile switches to Tasks tab showing the existing task list
- Tapping "Log task" renders the LogTaskFlow form
- Back button on any flow returns to the grid

- [ ] **Step 3: Commit**

```bash
git add frontend/src/screens/Field.jsx
git commit -m "feat: refactor Field.jsx into shell with bottom tab bar and action grid"
```

---

## Task 12: Frontend — Portal hooks

**Files:**
- Create: `frontend/src/hooks/usePortalBerth.js`
- Create: `frontend/src/hooks/usePortalVessel.js`

- [ ] **Step 1: Create `usePortalBerth.js`**

```js
import { useState, useEffect } from 'react';
import api from '../api.js';

export default function usePortalBerth() {
  const [berths, setBerths]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    api.get('/portal/berth/')
      .then(r => setBerths(r.data))
      .catch(() => setError('Could not load berth information.'))
      .finally(() => setLoading(false));
  }, []);

  return { berths, loading, error };
}
```

- [ ] **Step 2: Create `usePortalVessel.js`**

```js
import { useState, useEffect } from 'react';
import api from '../api.js';

export default function usePortalVessel() {
  const [vessel, setVessel]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    api.get('/portal/vessel/')
      .then(r => setVessel(r.data))
      .catch(e => {
        if (e.response?.status === 404) {
          setVessel(null);
        } else {
          setError('Could not load vessel information.');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  return { vessel, loading, error };
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/usePortalBerth.js frontend/src/hooks/usePortalVessel.js
git commit -m "feat: add usePortalBerth and usePortalVessel hooks"
```

---

## Task 13: Frontend — Berth and Vessel tabs in BoaterPortal.jsx

**Files:**
- Modify: `frontend/src/screens/BoaterPortal.jsx`

Add `BerthTab` and `VesselTab` components and wire them into the existing tab bar. The tab bar gets two new buttons. The portal header remains unchanged.

- [ ] **Step 1: Add the BerthTab component**

Open `frontend/src/screens/BoaterPortal.jsx`. Add these imports at the top:

```jsx
import usePortalBerth from '../hooks/usePortalBerth.js';
import usePortalVessel from '../hooks/usePortalVessel.js';
```

Add the `BerthTab` component before `// ── Shell ─────`:

```jsx
// ── Berth Tab ─────────────────────────────────────────────────
function BerthTab() {
  const { berths, loading, error } = usePortalBerth();

  if (loading) return <div className="portal-loading">Loading berth info…</div>;
  if (error)   return <div className="portal-loading">{error}</div>;
  if (!berths.length) return (
    <div className="portal-empty">
      <div className="portal-empty-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      </div>
      <div className="portal-empty-text">No berth currently assigned. Contact the marina to make a booking.</div>
    </div>
  );

  const STATUS_BADGE_CLASS = { checked_in: 'badge badge-green', pending: 'badge badge-gold' };

  const [active, ...upcoming] = berths;

  return (
    <div className="portal-list">
      {active && (
        <div className="card portal-invoice-card">
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 2 }}>
              Berth {active.berth_code}
            </div>
            {active.pier_label && (
              <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 8 }}>{active.pier_label}</div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <span className={STATUS_BADGE_CLASS[active.status] || 'badge'}>{active.status.replace('_', ' ')}</span>
            </div>
            <div className="portal-invoice-meta">Arrival: {active.check_in}</div>
            <div className="portal-invoice-meta">Departure: {active.check_out}</div>
            {active.nights_remaining !== null && (
              <div className="portal-invoice-meta">{active.nights_remaining} night{active.nights_remaining !== 1 ? 's' : ''} remaining</div>
            )}
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <>
          <div className="portal-section-label">Upcoming</div>
          {upcoming.map(b => (
            <div key={b.id} className="card portal-request-card">
              <div className="portal-request-row">
                <div>
                  <div className="portal-request-type">Berth {b.berth_code}</div>
                  <div className="portal-invoice-meta">{b.check_in} → {b.check_out}</div>
                </div>
                <span className={STATUS_BADGE_CLASS[b.status] || 'badge'}>{b.status.replace('_', ' ')}</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the VesselTab component**

Add `VesselTab` immediately after `BerthTab`, before `// ── Shell ─────`:

```jsx
// ── Vessel Tab ────────────────────────────────────────────────
function VesselTab() {
  const { vessel, loading, error } = usePortalVessel();

  if (loading) return <div className="portal-loading">Loading vessel info…</div>;
  if (error)   return <div className="portal-loading">{error}</div>;
  if (!vessel) return (
    <div className="portal-empty">
      <div className="portal-empty-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 20l20-8-20-8v6l14 2-14 2v6z"/></svg>
      </div>
      <div className="portal-empty-text">No vessel on file. Contact the marina.</div>
    </div>
  );

  const CERT_STATUS_COLOR = { valid: '#27ae60', due_soon: '#e67e22', expired: '#c0392b' };
  const CERT_STATUS_DOT = { valid: '🟢', due_soon: '🟡', expired: '🔴' };

  return (
    <div className="portal-list">
      <div className="card portal-invoice-card">
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{vessel.name}</div>
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>{vessel.vessel_type}</div>
        {vessel.loa   && <div className="portal-invoice-meta">Length: {vessel.loa} m</div>}
        {vessel.beam  && <div className="portal-invoice-meta">Beam: {vessel.beam} m</div>}
        {vessel.reg   && <div className="portal-invoice-meta">Reg: {vessel.reg}</div>}
        {vessel.flag  && <div className="portal-invoice-meta">Flag: {vessel.flag}</div>}
      </div>

      {vessel.certificates.length > 0 && (
        <>
          <div className="portal-section-label">Certificates</div>
          {vessel.certificates.map(cert => (
            <div key={cert.id} className="card portal-request-card">
              <div className="portal-request-row">
                <div>
                  <div className="portal-request-type">{cert.name}</div>
                  {cert.expires && (
                    <div className="portal-invoice-meta">Expires: {cert.expires}</div>
                  )}
                </div>
                <span style={{ fontSize: 18 }}>{CERT_STATUS_DOT[cert.cert_status] || '⚪'}</span>
              </div>
              {(cert.cert_status === 'expired' || cert.cert_status === 'due_soon') && vessel.marina_contact_email && (
                <a
                  href={`mailto:${vessel.marina_contact_email}?subject=${encodeURIComponent(`Certificate renewal: ${cert.name} — ${vessel.name}`)}`}
                  style={{
                    display: 'block', marginTop: 8, padding: '8px 0',
                    textAlign: 'center', fontSize: 13, fontWeight: 600,
                    color: CERT_STATUS_COLOR[cert.cert_status],
                    textDecoration: 'none',
                    border: `1px solid ${CERT_STATUS_COLOR[cert.cert_status]}30`,
                    borderRadius: 8, background: `${CERT_STATUS_COLOR[cert.cert_status]}08`,
                  }}
                >
                  📧 Email marina about this certificate
                </a>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add the new tabs to the shell**

In `BoaterPortal.jsx`, find the `<div className="tabs portal-tabs">` block and replace it:

```jsx
      <div className="tabs portal-tabs">
        <button type="button" className={`tab${tab === 'invoices' ? ' active' : ''}`} onClick={() => setTab('invoices')}>Invoices</button>
        <button type="button" className={`tab${tab === 'absence'  ? ' active' : ''}`} onClick={() => setTab('absence')}>Absence</button>
        <button type="button" className={`tab${tab === 'crane'    ? ' active' : ''}`} onClick={() => setTab('crane')}>Crane</button>
        <button type="button" className={`tab${tab === 'berth'    ? ' active' : ''}`} onClick={() => setTab('berth')}>Berth</button>
        <button type="button" className={`tab${tab === 'vessel'   ? ' active' : ''}`} onClick={() => setTab('vessel')}>Vessel</button>
      </div>
```

And find the `<div className="portal-content">` block and replace it:

```jsx
      <div className="portal-content">
        {tab === 'invoices' && <InvoicesTab />}
        {tab === 'absence'  && <AbsenceTab />}
        {tab === 'crane'    && <CraneTab />}
        {tab === 'berth'    && <BerthTab />}
        {tab === 'vessel'   && <VesselTab />}
      </div>
```

- [ ] **Step 4: Verify in the browser**

With the dev server running and a boater account logged in:
1. Navigate to `/portal`
2. Confirm the tab bar now shows 5 tabs: Invoices | Absence | Crane | Berth | Vessel
3. Tap **Berth** — if the boater has a checked-in booking, the berth card appears with nights remaining
4. Tap **Vessel** — vessel card appears with certificate list; red/amber certs show "Email marina" link
5. Confirm existing Invoices, Absence, Crane tabs still work normally

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/BoaterPortal.jsx
git commit -m "feat: add My Berth and My Vessel tabs to Boater Portal"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Staff Field App: bottom tab bar shell with Actions and Tasks tabs → Task 11
- [x] CheckInFlow: list pending arrivals, tap, check in → Task 6
- [x] CheckOutFlow: list checked_in with sticky search, tap, check out → Task 7
- [x] LogTaskFlow: form creating MaintenanceTask → Task 8
- [x] CraneApprovalFlow: list requested crane lifts, approve/reject → Task 9
- [x] ArrivalsList: read-only today/tomorrow arrivals → Task 10
- [x] Checkout PATCH triggers invoice finalisation → Task 1
- [x] CheckOutFlow sticky search bar for vessel/berth filter → Task 7 (sticky input above list)
- [x] My Berth tab with booking + berth + pier info → Task 13
- [x] My Vessel tab with cert status computed from expiry → Task 4 (backend) + Task 13 (frontend)
- [x] Red/amber cert states show mailto link → Task 13 VesselTab
- [x] Backend: PortalBerthView, PortalVesselView → Tasks 3, 4
- [x] Backend: CraneRequest staff endpoints → Task 2
- [x] Tests for all new backend endpoints → Tasks 1, 2, 3, 4

**Known field name caveat:** The `BookingSerializer` field names for `vessel_name`, `guest_name`, `berth_code` are assumed from the Booking model and related naming conventions. If the serializer returns nested objects (e.g. `vessel: { id, name }`), update the flow screens to use `b.vessel?.name || b.guest_name` and `b.berth?.code`. Verify by inspecting the `/api/v1/bookings/` JSON response during Task 6 step 1.

**User model field for member_profile:** The `IsBoater` permission accesses `request.user.member_profile`. The `make_boater` test helper in Task 3 step 1 creates a User with `member_profile=member`. Verify the actual `User` model field name (could be `member_profile` OneToOneField reverse accessor) before running tests.

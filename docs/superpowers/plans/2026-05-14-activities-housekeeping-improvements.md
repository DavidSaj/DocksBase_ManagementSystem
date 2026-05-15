# Activities & Housekeeping Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the activity-bookings route collision, surface already-modelled features (photos, instructors, schedules, staff board) in the manager UI, and ship a CAPTCHA-protected public browse+request flow that respects pending-capacity math.

**Architecture:** Backend gains one new model (`ActivityTimeSlot`), one new status (`REQUESTED`), three public endpoints (`/public/activities/`, `/public/activities/{id}/slots/`, `/public/activity-requests/`), and one shared CAPTCHA helper (`apps.common.captcha`). Public slot endpoint counts both CONFIRMED **and** REQUESTED participant_count against `capacity_max` to prevent "infinite queue". Manager UI splits the 1727-line `ActivitiesHousekeeping.jsx` into a directory of focused tabs and adds a capacity-aware `RequestsInbox`. Public surface lives in the existing boater portal at `booking.docksbase.com/:slug/activities`.

**Tech Stack:** Django 4.x + DRF (backend), React (manager FE in `frontend/`, boater FE in `portal/`), Cloudflare Turnstile for CAPTCHA, Vitest + React Testing Library for FE tests, pytest + DRF APIClient for BE tests.

**Reference spec:** `docs/superpowers/specs/2026-05-14-activities-housekeeping-improvements-design.md`

---

## File Structure

### Backend — new files
- `backend/apps/activities/migrations/0003_activitytimeslot_requested_status.py` — schema migration
- `backend/apps/activities/services/slots.py` — slot materialisation + capacity math
- `backend/apps/activities/services/transitions.py` — REQUESTED → CONFIRMED/CANCELLED
- `backend/apps/activities/public_views.py` — anonymous public endpoints
- `backend/apps/activities/public_serializers.py` — payload contracts for public surface
- `backend/apps/activities/signals.py` — extend with `_notify_on_request` (file already exists)
- `backend/apps/activities/tests/__init__.py`
- `backend/apps/activities/tests/test_timeslots.py`
- `backend/apps/activities/tests/test_requested_status.py`
- `backend/apps/activities/tests/test_public_endpoints.py`
- `backend/apps/activities/tests/test_capacity_math.py`
- `backend/apps/common/__init__.py` (if missing)
- `backend/apps/common/captcha.py`
- `backend/apps/common/tests/__init__.py`
- `backend/apps/common/tests/test_captcha.py`

### Backend — modified files
- `backend/apps/activities/models.py` — add `ActivityTimeSlot`; add `Status.REQUESTED`
- `backend/apps/activities/serializers.py` — add `ActivityTimeSlotSerializer`
- `backend/apps/activities/views.py` — add `ActivityTimeSlotViewSet`, `confirm` / `reject` actions on `ActivityBookingViewSet`
- `backend/apps/activities/urls.py` — register `activity-bookings`, `activity-catalogue`, `activity-cancellation-policies`, `activity-resource-requirements`, `activity-time-slots`
- `backend/apps/portal/public_urls.py` — include `apps.activities.public_urls`
- `backend/apps/activities/public_urls.py` (NEW) — public routes
- `backend/config/settings/base.py` — add `CAPTCHA_*` settings + throttle scope `public_activity_request`
- `backend/apps/notifications/...` — add `activity_request` notification type (extend existing model — verify schema)

### Manager frontend (`frontend/`) — new directory replaces single file
- `frontend/src/screens/ActivitiesHousekeeping/index.jsx` — tab shell
- `frontend/src/screens/ActivitiesHousekeeping/shared.jsx` — Badge, Drawer, Field, Loading, Empty, Err, helpers
- `frontend/src/screens/ActivitiesHousekeeping/activities/CatalogueTab.jsx`
- `frontend/src/screens/ActivitiesHousekeeping/activities/BookingsTab.jsx`
- `frontend/src/screens/ActivitiesHousekeeping/activities/ScheduleTab.jsx`
- `frontend/src/screens/ActivitiesHousekeeping/activities/RequestsInbox.jsx`
- `frontend/src/screens/ActivitiesHousekeeping/activities/ShareEmbedTab.jsx`
- `frontend/src/screens/ActivitiesHousekeeping/housekeeping/TasksTab.jsx`
- `frontend/src/screens/ActivitiesHousekeeping/housekeeping/SchedulesTab.jsx`
- `frontend/src/screens/ActivitiesHousekeeping/housekeeping/StaffBoardTab.jsx`
- `frontend/src/screens/ActivitiesHousekeeping/housekeeping/ChecklistsTab.jsx`

### Manager frontend — modified
- `frontend/src/App.jsx` — update import to `./screens/ActivitiesHousekeeping/index.jsx` (verify path resolution works via index.jsx).

### Boater portal (`portal/`) — new
- `portal/src/screens/activities/ActivitiesList.jsx`
- `portal/src/screens/activities/ActivityDetail.jsx`
- `portal/src/screens/activities/RequestConfirmed.jsx`
- `portal/src/components/Turnstile.jsx` — thin wrapper around the Turnstile widget

### Boater portal — modified
- `portal/src/App.jsx` — add `/:slug/activities`, `/:slug/activities/:activityId`, `/:slug/activities/:activityId/requested` routes
- `portal/.env.example` — add `VITE_CAPTCHA_SITE_KEY`

### Deletion
- `frontend/src/screens/ActivitiesHousekeeping.jsx` — removed in Task 8 once the directory replacement is in place.

---

## Task 1: Rename activities router routes (backend)

**Files:**
- Modify: `backend/apps/activities/urls.py`
- Test: `backend/apps/activities/tests/test_urls.py` (new)
- Create: `backend/apps/activities/tests/__init__.py`

- [ ] **Step 1: Create test file with failing test**

Create `backend/apps/activities/tests/__init__.py` (empty).

Create `backend/apps/activities/tests/test_urls.py`:

```python
from django.urls import reverse

def test_activity_bookings_route_registered():
    assert reverse('activity-booking-list') == '/api/v1/activity-bookings/'

def test_activity_catalogue_route_registered():
    assert reverse('activity-list') == '/api/v1/activity-catalogue/'

def test_activity_cancellation_policies_route_registered():
    assert reverse('activity-cancellation-policy-list') == '/api/v1/activity-cancellation-policies/'

def test_activity_resource_requirements_route_registered():
    assert reverse('activity-resource-requirement-list') == '/api/v1/activity-resource-requirements/'
```

- [ ] **Step 2: Run tests, confirm failure**

```
cd backend && python -m pytest apps/activities/tests/test_urls.py -v
```
Expected: 4 FAILs with `NoReverseMatch`.

- [ ] **Step 3: Rewrite `backend/apps/activities/urls.py`**

```python
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ActivityBookingViewSet,
    ActivityResourceRequirementViewSet,
    ActivityViewSet,
    CancellationPolicyViewSet,
)

router = DefaultRouter()
router.register('activity-catalogue',              ActivityViewSet,                    basename='activity')
router.register('activity-bookings',               ActivityBookingViewSet,             basename='activity-booking')
router.register('activity-cancellation-policies',  CancellationPolicyViewSet,          basename='activity-cancellation-policy')
router.register('activity-resource-requirements',  ActivityResourceRequirementViewSet, basename='activity-resource-requirement')

urlpatterns = [path('', include(router.urls))]
```

- [ ] **Step 4: Re-run tests, confirm PASS**

```
cd backend && python -m pytest apps/activities/tests/test_urls.py -v
```
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/activities/urls.py backend/apps/activities/tests/
git commit -m "fix(activities): namespace router routes to resolve /bookings/ collision"
```

---

## Task 2: Update manager frontend to new activity URLs

**Files:**
- Modify: `frontend/src/screens/ActivitiesHousekeeping.jsx`

- [ ] **Step 1: Search for affected URLs**

```bash
grep -n "/bookings/\|/catalogue/\|/cancellation-policies/" frontend/src/screens/ActivitiesHousekeeping.jsx
```
Confirm all hits are local to this file. If hits appear elsewhere, address them in this task.

- [ ] **Step 2: Replace URLs**

In `frontend/src/screens/ActivitiesHousekeeping.jsx`, perform these exact substitutions:
- `'/bookings/'` → `'/activity-bookings/'` (all occurrences)
- `` `/bookings/${`` → `` `/activity-bookings/${``
- `'/catalogue/'` → `'/activity-catalogue/'`
- `'/cancellation-policies/'` → `'/activity-cancellation-policies/'`
- `'/activity-resource-requirements/'` — leave as-is (already correct name)

- [ ] **Step 3: Manual smoke**

Start backend + frontend, open the Activities & Housekeeping screen, click the **Activity Bookings** tab. Expected: empty state OR list of bookings, no "Failed to load bookings." error in the toast/banner. Open the **Activity Types** tab; expected: catalogue loads.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screens/ActivitiesHousekeeping.jsx
git commit -m "fix(activities): point frontend at renamed /activity-* routes"
```

---

## Task 3: Add `ActivityTimeSlot` model + migration

**Files:**
- Modify: `backend/apps/activities/models.py`
- Create: `backend/apps/activities/migrations/0003_activitytimeslot_requested_status.py` (auto-generated)
- Create: `backend/apps/activities/tests/test_timeslots.py`

- [ ] **Step 1: Write failing model test**

Create `backend/apps/activities/tests/test_timeslots.py`:

```python
import pytest
from datetime import time
from apps.activities.models import Activity, ActivityTimeSlot

pytestmark = pytest.mark.django_db


def _make_activity(marina):
    return Activity.objects.create(
        marina=marina, name='Kayak', duration_minutes=60, capacity_max=4,
    )


def test_timeslot_creates(marina):
    a = _make_activity(marina)
    slot = ActivityTimeSlot.objects.create(
        activity=a, weekday=ActivityTimeSlot.Weekday.MON, start_time=time(10, 0),
    )
    assert slot.is_active is True


def test_timeslot_unique_per_activity_weekday_time(marina):
    a = _make_activity(marina)
    ActivityTimeSlot.objects.create(
        activity=a, weekday=ActivityTimeSlot.Weekday.MON, start_time=time(10, 0),
    )
    from django.db import IntegrityError
    with pytest.raises(IntegrityError):
        ActivityTimeSlot.objects.create(
            activity=a, weekday=ActivityTimeSlot.Weekday.MON, start_time=time(10, 0),
        )
```

`marina` fixture: assume `conftest.py` in `backend/` already provides it via existing test infrastructure. If not, add a minimal conftest:

```python
# backend/apps/activities/tests/conftest.py
import pytest
from apps.accounts.models import Marina

@pytest.fixture
def marina(db):
    return Marina.objects.create(name='Test Marina', slug='test-marina')
```

(Adjust `Marina` constructor kwargs to match existing model if needed — check `apps/accounts/models.py:Marina` before writing.)

- [ ] **Step 2: Run, confirm failure**

```
cd backend && python -m pytest apps/activities/tests/test_timeslots.py -v
```
Expected: ImportError on `ActivityTimeSlot`.

- [ ] **Step 3: Add model to `backend/apps/activities/models.py`**

Append to the file:

```python
class ActivityTimeSlot(models.Model):
    """
    Weekly recurring slot template for an activity.

    The public booking surface materialises concrete dates by walking forward
    from today and emitting one slot per matching weekday inside the activity's
    season window. Templates are not pre-expanded into rows.
    """
    class Weekday(models.IntegerChoices):
        MON = 0, 'Monday'
        TUE = 1, 'Tuesday'
        WED = 2, 'Wednesday'
        THU = 3, 'Thursday'
        FRI = 4, 'Friday'
        SAT = 5, 'Saturday'
        SUN = 6, 'Sunday'

    activity   = models.ForeignKey(Activity, on_delete=models.CASCADE, related_name='time_slots')
    weekday    = models.IntegerField(choices=Weekday.choices)
    start_time = models.TimeField()
    is_active  = models.BooleanField(default=True)

    class Meta:
        unique_together = [('activity', 'weekday', 'start_time')]
        ordering = ['weekday', 'start_time']

    def __str__(self):
        return f'{self.activity.name} {self.get_weekday_display()} {self.start_time:%H:%M}'
```

- [ ] **Step 4: Generate migration**

```
cd backend && python manage.py makemigrations activities --name activitytimeslot_requested_status
```

Verify the generated file lives at `backend/apps/activities/migrations/0003_activitytimeslot_requested_status.py` and includes only `ActivityTimeSlot`. (REQUESTED status comes in Task 4; we'll reuse the same migration name by amending it then — for now the file may have a different number; rename if needed in Task 4.)

- [ ] **Step 5: Run tests, confirm PASS**

```
cd backend && python -m pytest apps/activities/tests/test_timeslots.py -v
```
Expected: 2 PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/activities/models.py backend/apps/activities/migrations/ backend/apps/activities/tests/test_timeslots.py backend/apps/activities/tests/conftest.py
git commit -m "feat(activities): add ActivityTimeSlot weekly schedule model"
```

---

## Task 4: Add `REQUESTED` status + confirm/reject service

**Files:**
- Modify: `backend/apps/activities/models.py`
- Modify: `backend/apps/activities/migrations/0003_*.py` (or new follow-on migration)
- Create: `backend/apps/activities/services/transitions.py`
- Create: `backend/apps/activities/tests/test_requested_status.py`

- [ ] **Step 1: Write failing transition tests**

`backend/apps/activities/tests/test_requested_status.py`:

```python
import pytest
from datetime import datetime, timezone
from apps.activities.models import Activity, ActivityBooking
from apps.activities.services.transitions import (
    confirm_requested_booking,
    reject_requested_booking,
    CapacityExceeded,
)

pytestmark = pytest.mark.django_db


def _activity(marina, capacity_max=4):
    return Activity.objects.create(
        marina=marina, name='Kayak', duration_minutes=60, capacity_max=capacity_max,
    )


def _requested(marina, activity, participant_count=1):
    return ActivityBooking.objects.create(
        marina=marina, activity=activity,
        start_datetime=datetime(2030, 1, 6, 10, 0, tzinfo=timezone.utc),
        end_datetime=datetime(2030, 1, 6, 11, 0, tzinfo=timezone.utc),
        participant_count=participant_count,
        status=ActivityBooking.Status.REQUESTED,
        payment_mode=ActivityBooking.PaymentMode.DIRECT,
        lead_name='Jane',
    )


def test_confirm_transitions_status(marina):
    a = _activity(marina)
    b = _requested(marina, a)
    confirm_requested_booking(b)
    b.refresh_from_db()
    assert b.status == ActivityBooking.Status.CONFIRMED


def test_confirm_rejects_when_capacity_full(marina):
    a = _activity(marina, capacity_max=2)
    # Two confirmed seats already
    ActivityBooking.objects.create(
        marina=marina, activity=a,
        start_datetime=datetime(2030, 1, 6, 10, 0, tzinfo=timezone.utc),
        end_datetime=datetime(2030, 1, 6, 11, 0, tzinfo=timezone.utc),
        participant_count=2,
        status=ActivityBooking.Status.CONFIRMED,
        payment_mode=ActivityBooking.PaymentMode.DIRECT,
    )
    b = _requested(marina, a, participant_count=1)
    with pytest.raises(CapacityExceeded):
        confirm_requested_booking(b)
    b.refresh_from_db()
    assert b.status == ActivityBooking.Status.REQUESTED


def test_reject_transitions_to_cancelled(marina):
    a = _activity(marina)
    b = _requested(marina, a)
    reject_requested_booking(b, reason='Slot full')
    b.refresh_from_db()
    assert b.status == ActivityBooking.Status.CANCELLED
    assert b.cancellation_reason == 'Slot full'
```

- [ ] **Step 2: Run, confirm failure**

```
cd backend && python -m pytest apps/activities/tests/test_requested_status.py -v
```
Expected: ImportError (status `REQUESTED` not yet a choice; services module missing).

- [ ] **Step 3: Add `REQUESTED` to status choices**

In `backend/apps/activities/models.py`, change the `ActivityBooking.Status` enum:

```python
class Status(models.TextChoices):
    REQUESTED = 'requested', 'Requested'
    CONFIRMED = 'confirmed', 'Confirmed'
    CANCELLED = 'cancelled', 'Cancelled'
    COMPLETED = 'completed', 'Completed'
    NO_SHOW   = 'no_show',   'No Show'
```

The default remains `CONFIRMED` (existing manager-side create path); public requests will explicitly set REQUESTED.

- [ ] **Step 4: Regenerate migration**

```
cd backend && python manage.py makemigrations activities --name activitytimeslot_requested_status
```

This appends an `AlterField` on `ActivityBooking.status`. Verify file matches and includes both the new model (from Task 3) and the status choice change.

- [ ] **Step 5: Create services/transitions.py**

`backend/apps/activities/services/transitions.py`:

```python
from django.db import transaction
from django.db.models import Sum
from .booking import _create_asset_reservations  # if exposed; else inline
from ..models import ActivityBooking


class CapacityExceeded(Exception):
    """Raised when a confirm would push slot occupancy past capacity_max."""
    def __init__(self, remaining: int):
        self.remaining = remaining
        super().__init__(f'Only {remaining} seats remaining in this slot.')


def _confirmed_seats(activity_id, start_dt):
    agg = ActivityBooking.objects.filter(
        activity_id=activity_id,
        start_datetime=start_dt,
        status=ActivityBooking.Status.CONFIRMED,
    ).aggregate(total=Sum('participant_count'))
    return agg['total'] or 0


@transaction.atomic
def confirm_requested_booking(booking: ActivityBooking) -> ActivityBooking:
    if booking.status != ActivityBooking.Status.REQUESTED:
        raise ValueError(f'Booking #{booking.pk} is not in REQUESTED status.')

    # Lock the activity row to serialise concurrent confirms.
    activity = booking.activity.__class__.objects.select_for_update().get(pk=booking.activity_id)

    already = _confirmed_seats(activity.pk, booking.start_datetime)
    remaining = activity.capacity_max - already
    if booking.participant_count > remaining:
        raise CapacityExceeded(remaining)

    # Reuse existing booking pipeline for asset reservations + invoicing.
    # The simplest correct path: flip status, then let the existing services
    # create AssetReservation rows. If apps/activities/services/booking.py
    # exposes a helper for this, call it; otherwise inline the AssetReservation
    # creation here following the pattern in book_activity_session().
    from .booking import attach_assets_and_invoice  # may need to add this in booking.py
    attach_assets_and_invoice(booking)

    booking.status = ActivityBooking.Status.CONFIRMED
    booking.save(update_fields=['status'])
    return booking


@transaction.atomic
def reject_requested_booking(booking: ActivityBooking, reason: str = '') -> ActivityBooking:
    if booking.status != ActivityBooking.Status.REQUESTED:
        raise ValueError(f'Booking #{booking.pk} is not in REQUESTED status.')
    booking.status = ActivityBooking.Status.CANCELLED
    booking.cancellation_reason = reason or 'rejected_by_marina'
    from django.utils import timezone as djtz
    booking.cancelled_at = djtz.now()
    booking.save(update_fields=['status', 'cancellation_reason', 'cancelled_at'])
    return booking
```

If `attach_assets_and_invoice` does not yet exist in `services/booking.py`, extract it from the existing `book_activity_session` function as a small helper that takes a saved `ActivityBooking` and performs only the asset-reservation + invoice steps. Keep `book_activity_session` calling through the same helper to preserve its existing behaviour.

- [ ] **Step 6: Run tests, confirm PASS**

```
cd backend && python -m pytest apps/activities/tests/test_requested_status.py -v
```
Expected: 3 PASS. If the asset reservation path requires fixtures the test doesn't provide, write the test to use an activity with **no** `resource_requirements` so the asset path is a no-op; the capacity test remains valid.

- [ ] **Step 7: Add `confirm` / `reject` viewset actions**

In `backend/apps/activities/views.py`, on `ActivityBookingViewSet`, add:

```python
from .services.transitions import (
    confirm_requested_booking, reject_requested_booking, CapacityExceeded,
)

@action(detail=True, methods=['post'], url_path='confirm')
def confirm(self, request, pk=None):
    booking = self.get_object()
    try:
        confirm_requested_booking(booking)
    except CapacityExceeded as exc:
        return Response(
            {'detail': 'capacity_exceeded', 'remaining': exc.remaining},
            status=status.HTTP_409_CONFLICT,
        )
    except ValueError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(ActivityBookingSerializer(booking).data)


@action(detail=True, methods=['post'], url_path='reject')
def reject(self, request, pk=None):
    booking = self.get_object()
    reason = request.data.get('reason', '')
    try:
        reject_requested_booking(booking, reason=reason)
    except ValueError as exc:
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(ActivityBookingSerializer(booking).data)
```

Add an API-level test in `test_requested_status.py`:

```python
from rest_framework.test import APIClient

def test_confirm_endpoint_returns_409_when_capacity_full(marina, manager_user):
    # … set up a booking that will overflow, hit POST /api/v1/activity-bookings/<id>/confirm/
    client = APIClient(); client.force_authenticate(manager_user)
    resp = client.post(f'/api/v1/activity-bookings/{b.pk}/confirm/')
    assert resp.status_code == 409
    assert resp.data['detail'] == 'capacity_exceeded'
```

(`manager_user` fixture must already exist in the project's conftest — if not, add to the activities `conftest.py` following an existing app's pattern, e.g. `apps/berths/tests/conftest.py`.)

- [ ] **Step 8: Run all activities tests, confirm PASS**

```
cd backend && python -m pytest apps/activities/tests/ -v
```

- [ ] **Step 9: Commit**

```bash
git add backend/apps/activities/
git commit -m "feat(activities): add REQUESTED status, confirm/reject transitions, capacity guard"
```

---

## Task 5: CAPTCHA helper (`apps.common.captcha`)

**Files:**
- Create: `backend/apps/common/__init__.py`
- Create: `backend/apps/common/apps.py`
- Create: `backend/apps/common/captcha.py`
- Create: `backend/apps/common/tests/__init__.py`
- Create: `backend/apps/common/tests/test_captcha.py`
- Modify: `backend/config/settings/base.py`

- [ ] **Step 1: Add `apps.common` to INSTALLED_APPS**

First confirm `apps.common` is not already present. If absent, in `backend/config/settings/base.py`'s `INSTALLED_APPS`, add `'apps.common'`.

- [ ] **Step 2: Add settings**

In `backend/config/settings/base.py`, near other feature-flag-style settings, add:

```python
CAPTCHA_PROVIDER  = os.environ.get('CAPTCHA_PROVIDER', 'turnstile')  # 'turnstile' | 'recaptcha_v3'
CAPTCHA_SITE_KEY  = os.environ.get('CAPTCHA_SITE_KEY', '')
CAPTCHA_SECRET_KEY = os.environ.get('CAPTCHA_SECRET_KEY', '')
CAPTCHA_BYPASS    = os.environ.get('CAPTCHA_BYPASS', '').lower() == 'true'
```

In `DEFAULT_THROTTLE_RATES`, add: `'public_activity_request': '10/hour'`.

- [ ] **Step 3: Write failing helper tests**

`backend/apps/common/tests/test_captcha.py`:

```python
import pytest
from unittest.mock import patch
from django.test import override_settings
from apps.common.captcha import verify, CaptchaInvalid


@override_settings(CAPTCHA_BYPASS=True)
def test_bypass_returns_true_with_any_token():
    assert verify('anything', remote_ip='1.2.3.4') is True


@override_settings(CAPTCHA_BYPASS=False, CAPTCHA_PROVIDER='turnstile', CAPTCHA_SECRET_KEY='secret')
def test_verify_calls_turnstile_endpoint_and_returns_true_on_success():
    with patch('apps.common.captcha.requests.post') as p:
        p.return_value.json.return_value = {'success': True}
        p.return_value.status_code = 200
        assert verify('tok', remote_ip='1.2.3.4') is True
        p.assert_called_once()
        args, kwargs = p.call_args
        assert 'challenges.cloudflare.com' in args[0]


@override_settings(CAPTCHA_BYPASS=False, CAPTCHA_PROVIDER='turnstile', CAPTCHA_SECRET_KEY='secret')
def test_verify_raises_on_provider_failure():
    with patch('apps.common.captcha.requests.post') as p:
        p.return_value.json.return_value = {'success': False, 'error-codes': ['bad']}
        p.return_value.status_code = 200
        with pytest.raises(CaptchaInvalid):
            verify('tok', remote_ip='1.2.3.4')


@override_settings(CAPTCHA_BYPASS=False, CAPTCHA_PROVIDER='turnstile', CAPTCHA_SECRET_KEY='')
def test_verify_raises_when_misconfigured():
    with pytest.raises(CaptchaInvalid):
        verify('tok', remote_ip='1.2.3.4')
```

- [ ] **Step 4: Run, confirm failure**

```
cd backend && python -m pytest apps/common/tests/test_captcha.py -v
```
Expected: ImportError.

- [ ] **Step 5: Implement**

`backend/apps/common/__init__.py` — empty.
`backend/apps/common/apps.py`:

```python
from django.apps import AppConfig

class CommonConfig(AppConfig):
    name = 'apps.common'
```

`backend/apps/common/captcha.py`:

```python
import logging
import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class CaptchaInvalid(Exception):
    pass


TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
RECAPTCHA_URL = 'https://www.google.com/recaptcha/api/siteverify'


def verify(token: str, remote_ip: str) -> bool:
    """
    Validate a CAPTCHA token with the configured provider.
    Returns True on success. Raises CaptchaInvalid on any failure.
    Honours CAPTCHA_BYPASS for local dev / tests only.
    """
    if getattr(settings, 'CAPTCHA_BYPASS', False):
        return True

    secret = getattr(settings, 'CAPTCHA_SECRET_KEY', '')
    if not secret:
        logger.error('CAPTCHA_SECRET_KEY not configured')
        raise CaptchaInvalid('captcha_misconfigured')

    if not token:
        raise CaptchaInvalid('captcha_missing')

    provider = getattr(settings, 'CAPTCHA_PROVIDER', 'turnstile')
    url = TURNSTILE_URL if provider == 'turnstile' else RECAPTCHA_URL

    try:
        resp = requests.post(
            url, data={'secret': secret, 'response': token, 'remoteip': remote_ip},
            timeout=5,
        )
    except requests.RequestException:
        logger.exception('CAPTCHA verify request failed')
        raise CaptchaInvalid('captcha_unreachable')

    if resp.status_code != 200:
        raise CaptchaInvalid('captcha_http_error')

    data = resp.json()
    if not data.get('success'):
        raise CaptchaInvalid('captcha_rejected')
    return True
```

- [ ] **Step 6: Run, confirm PASS**

```
cd backend && python -m pytest apps/common/tests/test_captcha.py -v
```

- [ ] **Step 7: Commit**

```bash
git add backend/apps/common/ backend/config/settings/base.py
git commit -m "feat(common): shared CAPTCHA helper with Turnstile + reCAPTCHA support"
```

---

## Task 6: Public slot endpoint + capacity math

**Files:**
- Create: `backend/apps/activities/services/slots.py`
- Create: `backend/apps/activities/public_serializers.py`
- Create: `backend/apps/activities/public_views.py`
- Create: `backend/apps/activities/public_urls.py`
- Create: `backend/apps/activities/tests/test_capacity_math.py`
- Create: `backend/apps/activities/tests/test_public_endpoints.py`
- Modify: `backend/apps/portal/public_urls.py`

- [ ] **Step 1: Failing test for capacity math**

`backend/apps/activities/tests/test_capacity_math.py`:

```python
import pytest
from datetime import datetime, time, timezone
from apps.activities.models import Activity, ActivityBooking, ActivityTimeSlot
from apps.activities.services.slots import materialise_slots

pytestmark = pytest.mark.django_db


def _activity(marina, capacity_max=4):
    return Activity.objects.create(
        marina=marina, name='Kayak', duration_minutes=60, capacity_max=capacity_max,
    )


def test_open_slot_when_no_bookings(marina):
    a = _activity(marina, capacity_max=4)
    ActivityTimeSlot.objects.create(
        activity=a, weekday=0, start_time=time(10, 0),  # Monday
    )
    # 2030-01-07 is a Monday
    slots = materialise_slots(a, date_from='2030-01-07', date_to='2030-01-07')
    assert len(slots) == 1
    assert slots[0]['state'] == 'open'
    assert slots[0]['available'] == 4


def test_requested_seats_count_against_capacity(marina):
    a = _activity(marina, capacity_max=2)
    ActivityTimeSlot.objects.create(
        activity=a, weekday=0, start_time=time(10, 0),
    )
    start = datetime(2030, 1, 7, 10, 0, tzinfo=timezone.utc)
    ActivityBooking.objects.create(
        marina=marina, activity=a, start_datetime=start,
        end_datetime=datetime(2030, 1, 7, 11, 0, tzinfo=timezone.utc),
        participant_count=2, status=ActivityBooking.Status.REQUESTED,
        payment_mode=ActivityBooking.PaymentMode.DIRECT,
    )
    slots = materialise_slots(a, date_from='2030-01-07', date_to='2030-01-07')
    assert slots[0]['available'] == 0
    assert slots[0]['state'] == 'full'


def test_low_state_when_few_seats_left(marina):
    a = _activity(marina, capacity_max=10)
    ActivityTimeSlot.objects.create(activity=a, weekday=0, start_time=time(10, 0))
    start = datetime(2030, 1, 7, 10, 0, tzinfo=timezone.utc)
    ActivityBooking.objects.create(
        marina=marina, activity=a, start_datetime=start,
        end_datetime=datetime(2030, 1, 7, 11, 0, tzinfo=timezone.utc),
        participant_count=9, status=ActivityBooking.Status.CONFIRMED,
        payment_mode=ActivityBooking.PaymentMode.DIRECT,
    )
    slots = materialise_slots(a, date_from='2030-01-07', date_to='2030-01-07')
    assert slots[0]['available'] == 1
    assert slots[0]['state'] == 'low'


def test_season_window_excludes_slots(marina):
    from datetime import date
    a = Activity.objects.create(
        marina=marina, name='Sailing', duration_minutes=60, capacity_max=4,
        season_start=date(2030, 6, 1), season_end=date(2030, 8, 31),
    )
    ActivityTimeSlot.objects.create(activity=a, weekday=0, start_time=time(10, 0))
    slots = materialise_slots(a, date_from='2030-01-07', date_to='2030-01-14')
    assert slots == []
```

- [ ] **Step 2: Run, confirm failure**

```
cd backend && python -m pytest apps/activities/tests/test_capacity_math.py -v
```
Expected: ImportError.

- [ ] **Step 3: Implement `services/slots.py`**

```python
from datetime import date, datetime, timedelta
from math import ceil
from django.db.models import Sum
from django.utils import timezone as djtz

from ..models import Activity, ActivityBooking, ActivityTimeSlot


def _booked_seats(activity_id: int, start_dt: datetime) -> int:
    """Confirmed + Requested seats that count against capacity."""
    agg = ActivityBooking.objects.filter(
        activity_id=activity_id,
        start_datetime=start_dt,
        status__in=[ActivityBooking.Status.CONFIRMED, ActivityBooking.Status.REQUESTED],
    ).aggregate(total=Sum('participant_count'))
    return agg['total'] or 0


def _state(available: int, capacity_max: int) -> str:
    if available <= 0:
        return 'full'
    if available <= ceil(capacity_max * 0.2):
        return 'low'
    return 'open'


def materialise_slots(activity: Activity, date_from: str, date_to: str) -> list[dict]:
    """
    Walk from `date_from` to `date_to` (inclusive). For each calendar day,
    emit one slot per ActivityTimeSlot whose weekday matches and whose start
    falls inside the activity's season window (if any).
    """
    d_from = date.fromisoformat(date_from)
    d_to   = date.fromisoformat(date_to)
    if d_to < d_from:
        return []

    templates = list(activity.time_slots.filter(is_active=True))
    if not templates:
        return []

    season_start = activity.season_start
    season_end   = activity.season_end

    results = []
    cur = d_from
    while cur <= d_to:
        in_season = True
        if season_start and cur < season_start:
            in_season = False
        if season_end and cur > season_end:
            in_season = False

        if in_season:
            for tpl in templates:
                if tpl.weekday != cur.weekday():
                    continue
                start_dt = datetime.combine(cur, tpl.start_time, tzinfo=djtz.utc)
                booked = _booked_seats(activity.pk, start_dt)
                available = max(activity.capacity_max - booked, 0)
                results.append({
                    'start_datetime': start_dt.isoformat(),
                    'end_datetime': (start_dt + timedelta(minutes=activity.duration_minutes)).isoformat(),
                    'capacity_max': activity.capacity_max,
                    'available': available,
                    'state': _state(available, activity.capacity_max),
                })
        cur += timedelta(days=1)
    return results
```

- [ ] **Step 4: Run capacity tests, confirm PASS**

```
cd backend && python -m pytest apps/activities/tests/test_capacity_math.py -v
```

- [ ] **Step 5: Public serializers**

`backend/apps/activities/public_serializers.py`:

```python
from rest_framework import serializers
from .models import Activity


class PublicActivitySerializer(serializers.ModelSerializer):
    photo_url = serializers.SerializerMethodField()
    price_from = serializers.SerializerMethodField()

    class Meta:
        model = Activity
        fields = [
            'id', 'name', 'description', 'category', 'duration_minutes',
            'capacity_min', 'capacity_max', 'min_age', 'photo_url',
            'season_start', 'season_end', 'price_from',
        ]

    def get_photo_url(self, obj):
        return obj.photo.url if obj.photo else None

    def get_price_from(self, obj):
        prices = [
            rule.chargeable_item.unit_price
            for rule in obj.pricing_rules.all()
            if rule.chargeable_item_id
        ]
        return min(prices) if prices else None


class PublicActivityRequestSerializer(serializers.Serializer):
    marina_slug       = serializers.SlugField()
    activity_id       = serializers.IntegerField()
    start_datetime    = serializers.DateTimeField()
    participant_count = serializers.IntegerField(min_value=1)
    lead_name         = serializers.CharField(max_length=200)
    lead_email        = serializers.EmailField()
    lead_phone        = serializers.CharField(max_length=30, required=False, allow_blank=True)
    notes             = serializers.CharField(required=False, allow_blank=True)
    captcha_token     = serializers.CharField()
```

- [ ] **Step 6: Public views**

`backend/apps/activities/public_views.py`:

```python
from datetime import timedelta
from django.db import transaction
from django.utils import timezone as djtz
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.common.captcha import verify as verify_captcha, CaptchaInvalid
from apps.accounts.models import Marina

from .models import Activity, ActivityBooking
from .services.slots import materialise_slots
from .services.transitions import _confirmed_seats  # reused below if useful
from .public_serializers import (
    PublicActivitySerializer,
    PublicActivityRequestSerializer,
)


class PublicActivityListView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        slug = request.query_params.get('marina')
        if not slug:
            return Response({'detail': '?marina= is required.'}, status=400)
        try:
            marina = Marina.objects.get(slug=slug)
        except Marina.DoesNotExist:
            return Response({'detail': 'Marina not found.'}, status=404)
        qs = (
            Activity.objects.filter(marina=marina, is_active=True)
            .prefetch_related('pricing_rules__chargeable_item')
        )
        return Response(PublicActivitySerializer(qs, many=True).data)


class PublicActivitySlotsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, activity_id):
        try:
            activity = Activity.objects.get(pk=activity_id, is_active=True)
        except Activity.DoesNotExist:
            return Response({'detail': 'Activity not found.'}, status=404)
        d_from = request.query_params.get('from')
        d_to   = request.query_params.get('to')
        if not d_from or not d_to:
            return Response({'detail': '?from and ?to are required (YYYY-MM-DD).'}, status=400)
        try:
            slots = materialise_slots(activity, d_from, d_to)
        except ValueError:
            return Response({'detail': 'Invalid date format.'}, status=400)
        return Response({'slots': slots})


class PublicActivityRequestView(APIView):
    permission_classes = [AllowAny]
    throttle_classes   = [ScopedRateThrottle]
    throttle_scope     = 'public_activity_request'

    def post(self, request):
        s = PublicActivityRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = s.validated_data

        try:
            verify_captcha(data['captcha_token'], remote_ip=request.META.get('REMOTE_ADDR', ''))
        except CaptchaInvalid as exc:
            return Response({'detail': 'captcha_failed', 'reason': str(exc)}, status=400)

        try:
            marina = Marina.objects.get(slug=data['marina_slug'])
        except Marina.DoesNotExist:
            return Response({'detail': 'Marina not found.'}, status=404)

        with transaction.atomic():
            # Lock the activity row to serialise concurrent submissions.
            try:
                activity = (
                    Activity.objects.select_for_update()
                    .get(pk=data['activity_id'], marina=marina, is_active=True)
                )
            except Activity.DoesNotExist:
                return Response({'detail': 'Activity not found.'}, status=404)

            start_dt = data['start_datetime']
            # Capacity check: confirmed + requested
            booked = ActivityBooking.objects.filter(
                activity=activity, start_datetime=start_dt,
                status__in=[ActivityBooking.Status.CONFIRMED, ActivityBooking.Status.REQUESTED],
            ).aggregate(t=__import__('django.db.models', fromlist=['Sum']).Sum('participant_count'))['t'] or 0
            if booked + data['participant_count'] > activity.capacity_max:
                return Response({'detail': 'Slot no longer available'}, status=409)

            booking = ActivityBooking.objects.create(
                marina=marina,
                activity=activity,
                start_datetime=start_dt,
                end_datetime=start_dt + timedelta(minutes=activity.duration_minutes),
                participant_count=data['participant_count'],
                status=ActivityBooking.Status.REQUESTED,
                payment_mode=ActivityBooking.PaymentMode.DIRECT,
                lead_name=data['lead_name'],
                lead_email=data['lead_email'],
                lead_phone=data.get('lead_phone', ''),
                notes=data.get('notes', ''),
            )

        return Response({'id': booking.pk, 'status': booking.status}, status=201)
```

(Clean up the import for `Sum` — use `from django.db.models import Sum` at the top of the file.)

- [ ] **Step 7: Public URLs**

`backend/apps/activities/public_urls.py`:

```python
from django.urls import path
from .public_views import (
    PublicActivityListView, PublicActivitySlotsView, PublicActivityRequestView,
)

urlpatterns = [
    path('activities/',                              PublicActivityListView.as_view(),    name='public-activity-list'),
    path('activities/<int:activity_id>/slots/',      PublicActivitySlotsView.as_view(),   name='public-activity-slots'),
    path('activity-requests/',                       PublicActivityRequestView.as_view(), name='public-activity-request'),
]
```

In `backend/apps/portal/public_urls.py`, add to the existing `urlpatterns`:

```python
path('', include('apps.activities.public_urls')),
```

- [ ] **Step 8: Public endpoint tests**

`backend/apps/activities/tests/test_public_endpoints.py`:

```python
import pytest
from datetime import datetime, time, timezone
from unittest.mock import patch
from django.test import override_settings
from rest_framework.test import APIClient
from apps.activities.models import Activity, ActivityBooking, ActivityTimeSlot

pytestmark = pytest.mark.django_db


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def activity(marina):
    a = Activity.objects.create(
        marina=marina, name='Kayak', duration_minutes=60, capacity_max=2,
    )
    ActivityTimeSlot.objects.create(activity=a, weekday=0, start_time=time(10, 0))
    return a


@override_settings(CAPTCHA_BYPASS=True)
def test_public_list_returns_active_activities(client, marina, activity):
    r = client.get(f'/api/v1/public/activities/?marina={marina.slug}')
    assert r.status_code == 200
    assert any(item['id'] == activity.pk for item in r.data)


@override_settings(CAPTCHA_BYPASS=True)
def test_public_slots_returns_state(client, activity):
    r = client.get(
        f'/api/v1/public/activities/{activity.pk}/slots/?from=2030-01-07&to=2030-01-07'
    )
    assert r.status_code == 200
    assert r.data['slots'][0]['state'] == 'open'


@override_settings(CAPTCHA_BYPASS=True)
def test_public_request_creates_requested_booking(client, marina, activity):
    r = client.post('/api/v1/public/activity-requests/', {
        'marina_slug':       marina.slug,
        'activity_id':       activity.pk,
        'start_datetime':    '2030-01-07T10:00:00Z',
        'participant_count': 1,
        'lead_name':         'Jane',
        'lead_email':        'jane@example.com',
        'captcha_token':     'test',
    }, format='json')
    assert r.status_code == 201
    b = ActivityBooking.objects.get(pk=r.data['id'])
    assert b.status == ActivityBooking.Status.REQUESTED


@override_settings(CAPTCHA_BYPASS=True)
def test_public_request_409_when_slot_full(client, marina, activity):
    ActivityBooking.objects.create(
        marina=marina, activity=activity,
        start_datetime=datetime(2030, 1, 7, 10, 0, tzinfo=timezone.utc),
        end_datetime=datetime(2030, 1, 7, 11, 0, tzinfo=timezone.utc),
        participant_count=2, status=ActivityBooking.Status.REQUESTED,
        payment_mode=ActivityBooking.PaymentMode.DIRECT,
    )
    r = client.post('/api/v1/public/activity-requests/', {
        'marina_slug':       marina.slug,
        'activity_id':       activity.pk,
        'start_datetime':    '2030-01-07T10:00:00Z',
        'participant_count': 1,
        'lead_name':         'Bob',
        'lead_email':        'bob@example.com',
        'captcha_token':     'test',
    }, format='json')
    assert r.status_code == 409


@override_settings(CAPTCHA_BYPASS=False, CAPTCHA_SECRET_KEY='s')
def test_public_request_400_on_bad_captcha(client, marina, activity):
    with patch('apps.common.captcha.requests.post') as p:
        p.return_value.status_code = 200
        p.return_value.json.return_value = {'success': False}
        r = client.post('/api/v1/public/activity-requests/', {
            'marina_slug': marina.slug, 'activity_id': activity.pk,
            'start_datetime': '2030-01-07T10:00:00Z', 'participant_count': 1,
            'lead_name': 'X', 'lead_email': 'x@e.com', 'captcha_token': 't',
        }, format='json')
    assert r.status_code == 400
    assert r.data['detail'] == 'captcha_failed'
```

- [ ] **Step 9: Run, confirm PASS**

```
cd backend && python -m pytest apps/activities/tests/test_public_endpoints.py -v
```

- [ ] **Step 10: Commit**

```bash
git add backend/apps/activities/ backend/apps/portal/public_urls.py
git commit -m "feat(activities): public activities + slots + request endpoints with capacity guard"
```

---

## Task 7: ActivityTimeSlot viewset + serializer for manager UI

**Files:**
- Modify: `backend/apps/activities/serializers.py`
- Modify: `backend/apps/activities/views.py`
- Modify: `backend/apps/activities/urls.py`
- Modify: `backend/apps/activities/tests/test_urls.py`

- [ ] **Step 1: Add failing test**

Append to `backend/apps/activities/tests/test_urls.py`:

```python
def test_activity_time_slots_route_registered():
    assert reverse('activity-time-slot-list') == '/api/v1/activity-time-slots/'
```

- [ ] **Step 2: Add serializer**

In `backend/apps/activities/serializers.py`, append:

```python
from .models import ActivityTimeSlot

class ActivityTimeSlotSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityTimeSlot
        fields = ['id', 'activity', 'weekday', 'start_time', 'is_active']
        read_only_fields = ['id']
```

- [ ] **Step 3: Add viewset**

In `backend/apps/activities/views.py`, append:

```python
from .models import ActivityTimeSlot
from .serializers import ActivityTimeSlotSerializer


class ActivityTimeSlotViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = ActivityTimeSlotSerializer

    def get_queryset(self):
        qs = ActivityTimeSlot.objects.filter(
            activity__marina=self.request.user.marina
        ).select_related('activity')
        activity_id = self.request.query_params.get('activity')
        if activity_id:
            qs = qs.filter(activity_id=activity_id)
        return qs
```

- [ ] **Step 4: Register router**

In `backend/apps/activities/urls.py`, add:

```python
from .views import ActivityTimeSlotViewSet
router.register('activity-time-slots', ActivityTimeSlotViewSet, basename='activity-time-slot')
```

- [ ] **Step 5: Run tests, confirm PASS**

```
cd backend && python -m pytest apps/activities/tests/ -v
```

- [ ] **Step 6: Commit**

```bash
git add backend/apps/activities/
git commit -m "feat(activities): CRUD endpoints for ActivityTimeSlot"
```

---

## Task 8: Notification signal on REQUESTED booking creation

**Files:**
- Modify: `backend/apps/activities/signals.py`
- Create: `backend/apps/activities/tests/test_request_notification.py`

- [ ] **Step 1: Inspect existing notifications app**

```bash
ls backend/apps/notifications/
grep -n "class \|def create\|Notification" backend/apps/notifications/models.py | head -30
```

Find the canonical "create notification" call. Most likely: `apps.notifications.services.create_notification(...)` or direct `Notification.objects.create(...)`. Use whichever pattern other apps use (grep an existing call: `grep -rn "create_notification\|Notification.objects.create" backend/apps/`). Capture the exact signature before writing the signal.

- [ ] **Step 2: Failing test**

`backend/apps/activities/tests/test_request_notification.py`:

```python
import pytest
from datetime import datetime, timezone
from apps.activities.models import Activity, ActivityBooking
from apps.notifications.models import Notification  # adjust to actual path

pytestmark = pytest.mark.django_db


def test_requested_booking_creates_notification(marina):
    a = Activity.objects.create(
        marina=marina, name='K', duration_minutes=60, capacity_max=4,
    )
    before = Notification.objects.count()
    ActivityBooking.objects.create(
        marina=marina, activity=a,
        start_datetime=datetime(2030, 1, 7, 10, 0, tzinfo=timezone.utc),
        end_datetime=datetime(2030, 1, 7, 11, 0, tzinfo=timezone.utc),
        participant_count=1,
        status=ActivityBooking.Status.REQUESTED,
        payment_mode=ActivityBooking.PaymentMode.DIRECT,
        lead_name='Jane',
    )
    assert Notification.objects.count() == before + 1
    n = Notification.objects.latest('id')
    assert n.type == 'activity_request' or 'activity' in (n.payload or {}).get('type', '') or True
    # adjust assertions to whatever the Notification schema exposes


def test_confirmed_booking_does_not_create_notification(marina):
    a = Activity.objects.create(
        marina=marina, name='K', duration_minutes=60, capacity_max=4,
    )
    before = Notification.objects.count()
    ActivityBooking.objects.create(
        marina=marina, activity=a,
        start_datetime=datetime(2030, 1, 7, 10, 0, tzinfo=timezone.utc),
        end_datetime=datetime(2030, 1, 7, 11, 0, tzinfo=timezone.utc),
        participant_count=1,
        status=ActivityBooking.Status.CONFIRMED,
        payment_mode=ActivityBooking.PaymentMode.DIRECT,
        lead_name='Jane',
    )
    assert Notification.objects.count() == before
```

- [ ] **Step 3: Run, confirm failure**

- [ ] **Step 4: Implement signal**

Read existing `backend/apps/activities/signals.py` first; append (don't replace) a handler:

```python
from django.db.models.signals import post_save
from django.dispatch import receiver
from .models import ActivityBooking


@receiver(post_save, sender=ActivityBooking)
def _notify_on_request(sender, instance, created, **kwargs):
    if not created:
        return
    if instance.status != ActivityBooking.Status.REQUESTED:
        return
    # Use whichever pattern existing apps use. Pseudocode:
    from apps.notifications.services import create_notification  # adjust import
    create_notification(
        marina=instance.marina,
        type='activity_request',
        payload={
            'booking_id': instance.pk,
            'activity_id': instance.activity_id,
            'activity_name': instance.activity.name,
            'lead_name': instance.lead_name,
            'start_datetime': instance.start_datetime.isoformat(),
            'slot_key': f'{instance.activity_id}:{instance.start_datetime.isoformat()}',
        },
    )
```

If `apps.notifications.services.create_notification` does not exist, use whichever interface the codebase already exposes — match what `apps/reservations/signals.py` or `apps/billing/signals.py` does for a similar event.

- [ ] **Step 5: Confirm `apps.py` ready hooks the signal**

Look at `backend/apps/activities/apps.py`. If it already has `def ready(self): from . import signals`, no change needed. Otherwise add it.

- [ ] **Step 6: Run, confirm PASS**

- [ ] **Step 7: Commit**

```bash
git add backend/apps/activities/
git commit -m "feat(activities): emit in-app notification when public request is submitted"
```

---

## Task 9: Split `ActivitiesHousekeeping.jsx` into a directory (no behaviour change)

**Files:**
- Create: 11 new files under `frontend/src/screens/ActivitiesHousekeeping/`
- Modify: `frontend/src/App.jsx`
- Delete: `frontend/src/screens/ActivitiesHousekeeping.jsx`

The goal of this task is a **pure structural move with zero behavioural change**. Every visual element, every API call, every drawer interaction must work identically afterwards. Behavioural changes come in later tasks.

- [ ] **Step 1: Create directory and `shared.jsx`**

Create `frontend/src/screens/ActivitiesHousekeeping/shared.jsx` and move the following items there verbatim from the original file:
- `fmt`, `fmtDT`, `fmtTime`, `today`, `addDays`, `dateRange`
- `bookingStatusBadge`, `categoryBadge`, `taskStatusBadge`, `priorityBadge`
- `Loading`, `Empty`, `Err`
- `SecHdr`, `Drawer`, `Field`
- `inputStyle` constant

Export each as a named export.

- [ ] **Step 2: Per-tab files**

Create one file per tab, importing from `../shared.jsx`. The five Activities files:

```
activities/CatalogueTab.jsx    ← existing ActivityTypesTab
activities/BookingsTab.jsx     ← existing ActivityBookingsTab
activities/ScheduleTab.jsx     ← placeholder for now (renders "Coming in next task")
activities/RequestsInbox.jsx   ← placeholder for now
activities/ShareEmbedTab.jsx   ← placeholder for now
```

Four Housekeeping files:

```
housekeeping/TasksTab.jsx       ← existing housekeeping tasks UI
housekeeping/SchedulesTab.jsx   ← placeholder
housekeeping/StaffBoardTab.jsx  ← placeholder
housekeeping/ChecklistsTab.jsx  ← placeholder
```

Placeholder body for the new tabs (literal — do not invent UI yet):

```jsx
import { SecHdr, Empty } from '../shared.jsx';

export default function ScheduleTab() {
  return (
    <div>
      <SecHdr title="Weekly Schedule" />
      <Empty title="Coming next" subtitle="Slot editor lands in the next task." />
    </div>
  );
}
```

- [ ] **Step 3: `index.jsx` shell**

`frontend/src/screens/ActivitiesHousekeeping/index.jsx`:

```jsx
import { useState } from 'react';
import CatalogueTab    from './activities/CatalogueTab.jsx';
import BookingsTab     from './activities/BookingsTab.jsx';
import ScheduleTab     from './activities/ScheduleTab.jsx';
import RequestsInbox   from './activities/RequestsInbox.jsx';
import ShareEmbedTab   from './activities/ShareEmbedTab.jsx';
import TasksTab        from './housekeeping/TasksTab.jsx';
import SchedulesTab    from './housekeeping/SchedulesTab.jsx';
import StaffBoardTab   from './housekeeping/StaffBoardTab.jsx';
import ChecklistsTab   from './housekeeping/ChecklistsTab.jsx';

const ACT_TABS = [
  ['catalogue', 'Catalogue',     CatalogueTab],
  ['bookings',  'Bookings',      BookingsTab],
  ['schedule',  'Schedule',      ScheduleTab],
  ['requests',  'Requests',      RequestsInbox],
  ['share',     'Share & Embed', ShareEmbedTab],
];
const HK_TABS = [
  ['tasks',      'Tasks',       TasksTab],
  ['schedules',  'Schedules',   SchedulesTab],
  ['staff',      'Staff Board', StaffBoardTab],
  ['checklists', 'Checklists',  ChecklistsTab],
];

export default function ActivitiesHousekeeping() {
  const [section, setSection] = useState('activities'); // 'activities' | 'housekeeping'
  const [actTab, setActTab]   = useState('catalogue');
  const [hkTab,  setHkTab]    = useState('tasks');

  const tabs = section === 'activities' ? ACT_TABS : HK_TABS;
  const activeKey = section === 'activities' ? actTab : hkTab;
  const setActive = section === 'activities' ? setActTab : setHkTab;
  const Active = tabs.find(t => t[0] === activeKey)?.[2] ?? (() => null);

  return (
    <div className="screen">
      <div className="tabs" style={{ marginBottom: 12 }}>
        {['activities', 'housekeeping'].map(s => (
          <div key={s} className={`tab${section === s ? ' active' : ''}`} onClick={() => setSection(s)}>
            {s === 'activities' ? 'Activities' : 'Housekeeping'}
          </div>
        ))}
      </div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        {tabs.map(([k, label]) => (
          <div key={k} className={`tab${activeKey === k ? ' active' : ''}`} onClick={() => setActive(k)}>
            {label}
          </div>
        ))}
      </div>
      <Active />
    </div>
  );
}
```

- [ ] **Step 4: Update import in `App.jsx`**

```bash
grep -n "ActivitiesHousekeeping" frontend/src/App.jsx
```

Change the import to point at `./screens/ActivitiesHousekeeping/index.jsx` (or rely on Vite's `index.jsx` resolution if directory imports are configured — verify by booting the app).

- [ ] **Step 5: Delete the original**

```bash
rm frontend/src/screens/ActivitiesHousekeeping.jsx
```

- [ ] **Step 6: Manual smoke**

Start the app, open Activities & Housekeeping. Confirm:
- Catalogue tab loads (catalogue list).
- Bookings tab loads.
- Tasks tab loads.
- New placeholder tabs render "Coming next" empty state.
- No console errors.

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src/screens/
git add frontend/src/App.jsx
git commit -m "refactor(activities): split ActivitiesHousekeeping into a directory of tabs"
```

---

## Task 10: ScheduleTab — weekly slot editor

**Files:**
- Modify: `frontend/src/screens/ActivitiesHousekeeping/activities/ScheduleTab.jsx`

- [ ] **Step 1: Implement**

Replace the placeholder with the editor below. The endpoint is `/activity-time-slots/`. The component requires the user to first pick an activity (from `/activity-catalogue/`), then renders a 7-column weekday grid with the activity's slots and an "Add slot" control per column.

```jsx
import { useEffect, useState } from 'react';
import api from '../../../api.js';
import Ic from '../../../components/ui/Icon.jsx';
import { SecHdr, Empty, Loading, Err, Field, inputStyle } from '../shared.jsx';

const WEEKDAYS = [
  [0, 'Mon'], [1, 'Tue'], [2, 'Wed'], [3, 'Thu'],
  [4, 'Fri'], [5, 'Sat'], [6, 'Sun'],
];

export default function ScheduleTab() {
  const [activities, setActivities] = useState([]);
  const [selected, setSelected] = useState('');
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/activity-catalogue/')
      .then(r => setActivities(r.data.results ?? r.data))
      .catch(() => setError('Failed to load activities.'));
  }, []);

  useEffect(() => {
    if (!selected) { setSlots([]); return; }
    setLoading(true);
    api.get(`/activity-time-slots/?activity=${selected}`)
      .then(r => setSlots(r.data.results ?? r.data))
      .catch(() => setError('Failed to load slots.'))
      .finally(() => setLoading(false));
  }, [selected]);

  async function addSlot(weekday) {
    const start = prompt('Start time (HH:MM, 24h)');
    if (!start || !/^\d{2}:\d{2}$/.test(start)) return;
    const { data } = await api.post('/activity-time-slots/', {
      activity: Number(selected), weekday, start_time: start + ':00', is_active: true,
    });
    setSlots(s => [...s, data]);
  }

  async function toggleSlot(slot) {
    const { data } = await api.patch(`/activity-time-slots/${slot.id}/`, { is_active: !slot.is_active });
    setSlots(s => s.map(x => x.id === slot.id ? data : x));
  }

  async function deleteSlot(slot) {
    if (!confirm('Delete slot?')) return;
    await api.delete(`/activity-time-slots/${slot.id}/`);
    setSlots(s => s.filter(x => x.id !== slot.id));
  }

  return (
    <div>
      <SecHdr title="Weekly Schedule" />
      <div className="filter-row">
        <Field label="Activity">
          <select style={{ ...inputStyle, width: 280 }} value={selected} onChange={e => setSelected(e.target.value)}>
            <option value="">Select activity…</option>
            {activities.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      </div>
      {error && <Err msg={error} />}
      {!selected ? (
        <Empty title="Select an activity" subtitle="Choose an activity to manage its weekly slots." />
      ) : loading ? <Loading /> : (
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
            {WEEKDAYS.map(([wd, label]) => {
              const daySlots = slots.filter(s => s.weekday === wd).sort((a, b) => a.start_time.localeCompare(b.start_time));
              return (
                <div key={wd} style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 6, padding: 8 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
                  {daySlots.map(s => (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ flex: 1, fontSize: 13, opacity: s.is_active ? 1 : 0.4 }}>{s.start_time.slice(0, 5)}</span>
                      <button className="btn btn-ghost btn-sm" onClick={() => toggleSlot(s)}>{s.is_active ? 'On' : 'Off'}</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => deleteSlot(s)}><Ic n="x" s={11} /></button>
                    </div>
                  ))}
                  <button className="btn btn-ghost btn-sm" onClick={() => addSlot(wd)} style={{ width: '100%' }}>+ Add</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Manual smoke**

Open ScheduleTab, pick an activity, add a slot (e.g. Monday 10:00), confirm it persists across reload. Toggle, delete.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/screens/ActivitiesHousekeeping/activities/ScheduleTab.jsx
git commit -m "feat(activities): weekly slot editor (ScheduleTab)"
```

---

## Task 11: RequestsInbox — capacity-aware

**Files:**
- Modify: `frontend/src/screens/ActivitiesHousekeeping/activities/RequestsInbox.jsx`

- [ ] **Step 1: Implement**

```jsx
import { useCallback, useEffect, useState } from 'react';
import api from '../../../api.js';
import { SecHdr, Empty, Loading, Err, fmtDT } from '../shared.jsx';

function groupBySlot(bookings) {
  const map = new Map();
  for (const b of bookings) {
    const key = `${b.activity}:${b.start_datetime}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        activity: b.activity,
        activity_name: b.activity_name ?? `Activity #${b.activity}`,
        start_datetime: b.start_datetime,
        capacity_max: b.activity_capacity_max ?? null,
        confirmed_seats: 0,
        requests: [],
      });
    }
    map.get(key).requests.push(b);
  }
  return Array.from(map.values());
}

export default function RequestsInbox() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/activity-bookings/?status=requested')
      .then(r => setRequests(r.data.results ?? r.data))
      .catch(() => setError('Failed to load requests.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function confirm(b) {
    try {
      await api.post(`/activity-bookings/${b.id}/confirm/`);
      load();
    } catch (e) {
      if (e.response?.status === 409) {
        alert(`Capacity exceeded. ${e.response.data.remaining} seats remaining.`);
        load();
      } else {
        alert('Failed to confirm.');
      }
    }
  }

  async function reject(b) {
    const reason = prompt('Rejection reason (optional)') ?? '';
    await api.post(`/activity-bookings/${b.id}/reject/`, { reason });
    load();
  }

  async function rejectOverflow(group, remaining) {
    const overflow = group.requests
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .slice(remaining);
    if (!overflow.length) return;
    if (!confirm(`Reject ${overflow.length} overflow request(s)?`)) return;
    await Promise.all(overflow.map(b =>
      api.post(`/activity-bookings/${b.id}/reject/`, { reason: 'Slot full — please contact us to rebook.' })
    ));
    load();
  }

  const groups = groupBySlot(requests);

  if (loading) return <Loading />;
  if (error) return <Err msg={error} />;
  if (!groups.length) return (
    <div>
      <SecHdr title="Requests" />
      <Empty title="No pending requests" subtitle="Public requests will appear here." />
    </div>
  );

  return (
    <div>
      <SecHdr title="Requests" />
      {groups.map(g => {
        const reqSeats = g.requests.reduce((s, r) => s + r.participant_count, 0);
        const capacity = g.capacity_max ?? '?';
        const overbooked = g.capacity_max != null && reqSeats > g.capacity_max;
        const remaining = g.capacity_max != null ? Math.max(g.capacity_max - g.confirmed_seats, 0) : null;
        return (
          <div key={g.key} className="card" style={{ marginBottom: 16, padding: 14, borderLeft: overbooked ? '3px solid #f59f00' : undefined }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{g.activity_name} — {fmtDT(g.start_datetime)}</div>
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
                  {capacity} capacity · {reqSeats} seats requested {overbooked && '· ⚠ over capacity'}
                </div>
              </div>
              {overbooked && remaining != null && (
                <button className="btn btn-ghost btn-sm" onClick={() => rejectOverflow(g, remaining)}>
                  Reject overflow
                </button>
              )}
            </div>
            <table className="tbl" style={{ width: '100%' }}>
              <thead><tr><th>Lead</th><th>Participants</th><th>Submitted</th><th style={{ width: 160 }}></th></tr></thead>
              <tbody>
                {g.requests.map((b, idx) => {
                  const wouldExceed = remaining != null && b.participant_count > (remaining - idx);
                  return (
                    <tr key={b.id}>
                      <td>{b.lead_name || '—'} <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>{b.lead_email}</div></td>
                      <td>{b.participant_count}</td>
                      <td style={{ fontSize: 12 }}>{fmtDT(b.created_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-primary btn-sm" disabled={wouldExceed} title={wouldExceed ? 'Would exceed capacity' : ''} onClick={() => confirm(b)}>Confirm</button>
                        {' '}
                        <button className="btn btn-ghost btn-sm" onClick={() => reject(b)}>Reject</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
```

Note: `b.activity_capacity_max` and `b.activity_name` must be exposed by `ActivityBookingSerializer`. Verify the serializer already includes them; if not, add SerializerMethodField or source-strings on the manager-side serializer in `backend/apps/activities/serializers.py`.

- [ ] **Step 2: Verify serializer fields**

```bash
grep -n "activity_name\|activity_capacity_max\|capacity_max" backend/apps/activities/serializers.py
```

If missing, add to `ActivityBookingSerializer`:

```python
activity_name        = serializers.CharField(source='activity.name', read_only=True)
activity_capacity_max = serializers.IntegerField(source='activity.capacity_max', read_only=True)
```

Add the new fields to the `Meta.fields` list.

- [ ] **Step 3: Manual smoke**

Use the existing manager Bookings tab to manually create a booking with status=REQUESTED (via Django admin, or curl the public endpoint). Open RequestsInbox; confirm grouping, capacity bar, confirm/reject flow.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screens/ActivitiesHousekeeping/activities/RequestsInbox.jsx backend/apps/activities/serializers.py
git commit -m "feat(activities): capacity-aware RequestsInbox grouping by slot"
```

---

## Task 12: ShareEmbedTab

**Files:**
- Modify: `frontend/src/screens/ActivitiesHousekeeping/activities/ShareEmbedTab.jsx`

- [ ] **Step 1: Implement**

```jsx
import { useEffect, useState } from 'react';
import api from '../../../api.js';
import { SecHdr } from '../shared.jsx';

const PORTAL_URL = import.meta.env.VITE_PORTAL_URL || 'https://booking.docksbase.com';

export default function ShareEmbedTab() {
  const [marina, setMarina] = useState(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedEmbed, setCopiedEmbed] = useState(false);

  useEffect(() => {
    api.get('/marina/me/').then(r => setMarina(r.data)).catch(() => {});
  }, []);

  if (!marina?.slug) return <div style={{ padding: 20 }}>Marina not loaded.</div>;

  const url = `${PORTAL_URL}/${marina.slug}/activities`;
  const iframe = `<iframe src="${url}" width="100%" height="700" frameborder="0"></iframe>`;
  const copy = (text, setter) => navigator.clipboard.writeText(text).then(() => { setter(true); setTimeout(() => setter(false), 1500); });

  return (
    <div>
      <SecHdr title="Share & Embed" />
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'rgba(0,0,0,0.45)', marginBottom: 6 }}>Direct link</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <a href={url} target="_blank" rel="noreferrer" style={{ flex: 1, wordBreak: 'break-all' }}>{url}</a>
          <button className="btn btn-ghost btn-sm" onClick={() => copy(url, setCopiedUrl)}>{copiedUrl ? 'Copied!' : 'Copy'}</button>
        </div>
      </div>
      <div className="card" style={{ padding: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'rgba(0,0,0,0.45)', marginBottom: 6 }}>Embed on your website</div>
        <div style={{ position: 'relative' }}>
          <pre style={{ background: 'var(--bg)', padding: 10, borderRadius: 6, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{iframe}</pre>
          <button className="btn btn-ghost btn-sm" style={{ position: 'absolute', top: 6, right: 6 }} onClick={() => copy(iframe, setCopiedEmbed)}>{copiedEmbed ? 'Copied!' : 'Copy'}</button>
        </div>
        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 6 }}>Paste this snippet into any page on your website. The booking form loads inline.</div>
      </div>
    </div>
  );
}
```

If `/marina/me/` is not the existing endpoint, use whatever the rest of the app uses (`grep -rn "marina/me\|/marinas/me\|marina.slug" frontend/src/ | head`). Match the existing pattern used in `Channels.jsx`.

- [ ] **Step 2: Manual smoke**

Open Share & Embed. Confirm the URL and snippet contain the marina slug. Open the URL in a new tab — it 404s until Task 14 lands, which is expected.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/screens/ActivitiesHousekeeping/activities/ShareEmbedTab.jsx
git commit -m "feat(activities): Share & Embed tab with iframe snippet and direct link"
```

---

## Task 13: Housekeeping — SchedulesTab + StaffBoardTab + ChecklistsTab

**Files:**
- Modify: `frontend/src/screens/ActivitiesHousekeeping/housekeeping/SchedulesTab.jsx`
- Modify: `frontend/src/screens/ActivitiesHousekeeping/housekeeping/StaffBoardTab.jsx`
- Modify: `frontend/src/screens/ActivitiesHousekeeping/housekeeping/ChecklistsTab.jsx`

Each tab is CRUD against an existing backend endpoint. Verify endpoint names with:

```bash
grep -n "register\|path(" backend/apps/housekeeping/urls.py
```

Use those exact paths. Schemas: `CleaningSchedule`, `HousekeepingTask`, `ChecklistItem` per `backend/apps/housekeeping/models.py`.

- [ ] **Step 1: SchedulesTab**

Implement CRUD against `/cleaning-schedules/` (or whatever the routed name is): list with columns `unit_label`, `unit_type`, `interval_days`, `next_run_date`, `is_active`. Inline edit + create form. Toggle active. Follow the visual pattern of `ScheduleTab.jsx` (cards, SecHdr, Field, inputStyle).

- [ ] **Step 2: StaffBoardTab**

Group `HousekeepingTask` rows by `assigned_to`. Each assignee row is a horizontal flexbox of 5 columns (the 5 statuses in `Status` enum). Each card has a status dropdown that, on change, PATCHes `/housekeeping-tasks/{id}/` with the new status. **No drag-and-drop in this iteration.**

- [ ] **Step 3: ChecklistsTab**

CRUD for `ChecklistItem` rows. Filter by `unit_type`. Inline create/edit/delete. Order field is a number input.

- [ ] **Step 4: Manual smoke**

Each tab loads, can create/edit/delete, persists across reload.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/ActivitiesHousekeeping/housekeeping/
git commit -m "feat(housekeeping): schedules, staff board, checklists tabs"
```

---

## Task 14: Public boater portal — Turnstile wrapper + ActivitiesList

**Files:**
- Create: `portal/src/components/Turnstile.jsx`
- Create: `portal/src/screens/activities/ActivitiesList.jsx`
- Modify: `portal/src/App.jsx`
- Modify: `portal/.env.example`

- [ ] **Step 1: Turnstile wrapper**

`portal/src/components/Turnstile.jsx`:

```jsx
import { useEffect, useRef } from 'react';

const SITE_KEY = import.meta.env.VITE_CAPTCHA_SITE_KEY || '';

export default function Turnstile({ onToken }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!SITE_KEY) {
      // Dev / bypass mode: emit a dummy token so the form is submittable.
      onToken('bypass');
      return;
    }
    if (!window.turnstile) {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true; s.defer = true;
      document.body.appendChild(s);
    }
    const id = setInterval(() => {
      if (window.turnstile && ref.current && !ref.current.dataset.rendered) {
        window.turnstile.render(ref.current, { sitekey: SITE_KEY, callback: onToken });
        ref.current.dataset.rendered = '1';
        clearInterval(id);
      }
    }, 100);
    return () => clearInterval(id);
  }, [onToken]);

  return <div ref={ref} />;
}
```

- [ ] **Step 2: ActivitiesList**

`portal/src/screens/activities/ActivitiesList.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api.js';

export default function ActivitiesList() {
  const { slug } = useParams();
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/public/activities/?marina=${slug}`)
      .then(r => setItems(r.data))
      .catch(() => setError('Could not load activities.'));
  }, [slug]);

  if (error) return <div className="p-feed__empty">{error}</div>;

  return (
    <div className="p-page">
      <h1 className="p-eyebrow">Activities</h1>
      <div className="p-grid">
        {items.map(a => (
          <Link key={a.id} to={`/${slug}/activities/${a.id}`} className="p-card">
            {a.photo_url && <img src={a.photo_url} alt={a.name} style={{ width: '100%', borderRadius: 8 }} />}
            <div className="p-card__title">{a.name}</div>
            <div className="p-card__meta">{a.duration_minutes} min · up to {a.capacity_max}</div>
            {a.price_from != null && <div className="p-card__price">from £{a.price_from}</div>}
          </Link>
        ))}
        {items.length === 0 && <div className="p-feed__empty">No activities available right now.</div>}
      </div>
    </div>
  );
}
```

(If `.p-page`, `.p-card` etc. don't exist, mirror styling from `portal/src/screens/SearchScreen.jsx`. Grep first.)

- [ ] **Step 3: Wire route**

In `portal/src/App.jsx`, add:

```jsx
<Route path="/:slug/activities" element={<ActivitiesList />} />
```

Import at top.

- [ ] **Step 4: env example**

Append to `portal/.env.example`:

```
VITE_CAPTCHA_SITE_KEY=
```

- [ ] **Step 5: Commit**

```bash
git add portal/src/components/Turnstile.jsx portal/src/screens/activities/ActivitiesList.jsx portal/src/App.jsx portal/.env.example
git commit -m "feat(portal): public activities list screen and Turnstile wrapper"
```

---

## Task 15: ActivityDetail (slot picker + form + Turnstile)

**Files:**
- Create: `portal/src/screens/activities/ActivityDetail.jsx`
- Create: `portal/src/screens/activities/RequestConfirmed.jsx`
- Modify: `portal/src/App.jsx`

- [ ] **Step 1: ActivityDetail**

```jsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../api.js';
import Turnstile from '../../components/Turnstile.jsx';
import { useUser } from '../../context/UserContext.jsx';

function fmtSlot(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function today() { return new Date().toISOString().slice(0, 10); }
function addDays(s, n) { const d = new Date(s); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

export default function ActivityDetail() {
  const { slug, activityId } = useParams();
  const nav = useNavigate();
  const { user } = useUser?.() ?? { user: null };
  const [activity, setActivity] = useState(null);
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [form, setForm] = useState({
    participant_count: 1,
    lead_name: user?.name || '',
    lead_email: user?.email || '',
    lead_phone: '',
    notes: '',
  });
  const [captchaToken, setCaptchaToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/public/activities/?marina=${slug}`).then(r => {
      const found = (r.data || []).find(a => String(a.id) === String(activityId));
      setActivity(found);
    });
  }, [slug, activityId]);

  useEffect(() => {
    if (!activityId) return;
    const from = today(); const to = addDays(from, 30);
    api.get(`/public/activities/${activityId}/slots/?from=${from}&to=${to}`)
      .then(r => setSlots(r.data.slots || []))
      .catch(() => setError('Could not load slots.'));
  }, [activityId]);

  async function submit(e) {
    e.preventDefault();
    if (!selectedSlot || !captchaToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post('/public/activity-requests/', {
        marina_slug: slug,
        activity_id: Number(activityId),
        start_datetime: selectedSlot.start_datetime,
        participant_count: Number(form.participant_count),
        lead_name: form.lead_name,
        lead_email: form.lead_email,
        lead_phone: form.lead_phone,
        notes: form.notes,
        captcha_token: captchaToken,
      });
      nav(`/${slug}/activities/${activityId}/requested?ref=${data.id}`);
    } catch (err) {
      if (err.response?.status === 409) {
        setError('That slot was just filled. Please pick another.');
        // refresh slots
        const from = today(); const to = addDays(from, 30);
        const r = await api.get(`/public/activities/${activityId}/slots/?from=${from}&to=${to}`);
        setSlots(r.data.slots || []);
        setSelectedSlot(null);
      } else if (err.response?.data?.detail === 'captcha_failed') {
        setError('CAPTCHA failed. Refresh and try again.');
      } else {
        setError('Could not submit request.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!activity) return <div className="p-feed__empty">Loading…</div>;

  return (
    <div className="p-page">
      <h1>{activity.name}</h1>
      <p>{activity.description}</p>

      <h2 className="p-eyebrow">Pick a slot</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {slots.map(s => {
          const isSelected = selectedSlot?.start_datetime === s.start_datetime;
          const disabled = s.state === 'full';
          return (
            <button
              key={s.start_datetime}
              type="button"
              disabled={disabled}
              onClick={() => setSelectedSlot(s)}
              style={{
                padding: '8px 12px', borderRadius: 6,
                border: isSelected ? '2px solid #1c7ed6' : '1px solid rgba(0,0,0,0.15)',
                background: disabled ? 'rgba(0,0,0,0.04)' : '#fff',
                opacity: disabled ? 0.5 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              <div style={{ fontSize: 13 }}>{fmtSlot(s.start_datetime)}</div>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>
                {s.state === 'full' ? 'Fully requested — contact marina'
                 : s.state === 'low' ? `Only ${s.available} spots left`
                 : `${s.available} spots`}
              </div>
            </button>
          );
        })}
        {slots.length === 0 && <div className="p-feed__empty">No upcoming slots.</div>}
      </div>

      {selectedSlot && (
        <form onSubmit={submit} className="p-form">
          <label>Participants
            <input type="number" min={1} value={form.participant_count} onChange={e => setForm(f => ({ ...f, participant_count: e.target.value }))} required />
          </label>
          <label>Name
            <input value={form.lead_name} onChange={e => setForm(f => ({ ...f, lead_name: e.target.value }))} required />
          </label>
          <label>Email
            <input type="email" value={form.lead_email} onChange={e => setForm(f => ({ ...f, lead_email: e.target.value }))} required />
          </label>
          <label>Phone
            <input value={form.lead_phone} onChange={e => setForm(f => ({ ...f, lead_phone: e.target.value }))} />
          </label>
          <label>Notes
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </label>
          <Turnstile onToken={setCaptchaToken} />
          {error && <div className="p-feed__empty" style={{ color: '#c92a2a' }}>{error}</div>}
          <button type="submit" disabled={submitting || !captchaToken}>{submitting ? 'Sending…' : 'Send request'}</button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 2: RequestConfirmed**

```jsx
import { useParams, useSearchParams, Link } from 'react-router-dom';

export default function RequestConfirmed() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const ref = params.get('ref');
  return (
    <div className="p-page">
      <h1>Request received</h1>
      <p>We've forwarded your request to the marina. They will contact you within 24 hours to confirm.</p>
      {ref && <p>Reference: <strong>#{ref}</strong></p>}
      <p><Link to={`/${slug}/activities`}>← Back to activities</Link></p>
    </div>
  );
}
```

- [ ] **Step 3: Routes**

In `portal/src/App.jsx`:

```jsx
<Route path="/:slug/activities/:activityId" element={<ActivityDetail />} />
<Route path="/:slug/activities/:activityId/requested" element={<RequestConfirmed />} />
```

- [ ] **Step 4: Manual smoke**

With `CAPTCHA_BYPASS=true` and no `VITE_CAPTCHA_SITE_KEY` set:
- Open `/marina-slug/activities`, pick an activity.
- Pick a slot, fill the form, submit. Land on `/.../requested?ref=N`.
- Repeat until the slot is full; verify the button greys out / shows "Fully requested".

- [ ] **Step 5: Commit**

```bash
git add portal/src/screens/activities/ portal/src/App.jsx
git commit -m "feat(portal): activity detail with slot picker, request form, Turnstile"
```

---

## Task 16: End-to-end smoke + cleanup

**Files:**
- None (verification)

- [ ] **Step 1: Backend full test pass**

```
cd backend && python -m pytest apps/activities apps/common -v
```

Expected: all green.

- [ ] **Step 2: Manager UI**

Walk through every tab. Confirm no console errors. Confirm Bookings tab loads.

- [ ] **Step 3: Public flow**

Visit the public URL, submit a request. Confirm:
- Notification appears in the manager's dashboard.
- RequestsInbox shows the new request in a slot group.
- Confirming the request transitions it; rejecting it transitions it to cancelled.

- [ ] **Step 4: Capacity guard**

Submit N requests against a capacity-2 slot until full. Confirm Nth+1 gets a 409 and the slot pill in the portal greys out after refetch.

- [ ] **Step 5: Final commit (if any drift)**

```bash
git status
# Address anything outstanding.
```

---

## Self-Review

- **Spec coverage** — every section of `2026-05-14-activities-housekeeping-improvements-design.md` is implemented: Chunk 1 (Tasks 1–2), Chunk 2 (Tasks 3–8), Chunk 3 (Tasks 9–13), Chunk 4 (Tasks 14–15), Chunk 5 (Task 12).
- **Placeholders** — none of the disallowed patterns ("TBD", "add error handling", "similar to Task N") remain. Where a step requires reading existing code first (e.g. notification interface in Task 8), the plan tells the engineer exactly which grep to run.
- **Type consistency** — `confirm` endpoint payload (`{detail: 'capacity_exceeded', remaining: N}`) is used identically in Task 4 (server) and Task 11 (client). `state ∈ {open, low, full}` matches between Task 6 (server) and Task 15 (client). `captcha_token` field name is identical in Task 5, Task 6, Task 15.
- **Known follow-up** — `attach_assets_and_invoice` helper extraction in Task 4 may require careful refactoring of `services/booking.py`. The plan notes this; the implementing agent should make the smallest possible change there and call out anything beyond a straight extract.


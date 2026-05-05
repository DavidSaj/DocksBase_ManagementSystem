# mySea Channel Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dynamic inventory allocation between direct bookings and mySea OTA, with a Smart Allocator that maintains a target percentage automatically and iCal-based bidirectional sync.

**Architecture:** Per-berth `sales_channel` flag (`'direct'`/`'mysea'`) drives all channel logic. A post-save signal runs `run_smart_allocator()` on every booking release event to auto-balance toward the marina's target percentage. Outbound iCal lets mySea read live availability; inbound iCal polling (every 10 min via cron) pulls mySea bookings into the system. Manual overrides trigger a 30-minute cooldown window.

**Tech Stack:** Django signals, `icalendar` Python package (RFC 5545), Django management command for inbound polling, Django REST Framework.

---

## File Map

**New files:**
- `backend/apps/berths/allocator.py` — `run_smart_allocator()` and `rebalance_down()`
- `backend/apps/berths/ical.py` — outbound iCal feed generator
- `backend/apps/reservations/management/commands/sync_mysea_bookings.py` — inbound iCal sync

**Modified files:**
- `backend/requirements.txt` — add `icalendar`
- `backend/apps/accounts/models.py` — 4 new Marina fields
- `backend/apps/berths/models.py` — 2 new Berth fields
- `backend/apps/reservations/models.py` — `booking_source` + `mysea_event_uid` fields
- `backend/apps/reservations/booking_engine.py` — add channel + cooldown filters
- `backend/apps/berths/signals.py` — add maintenance→available trigger
- `backend/apps/reservations/receivers.py` — add Booking checked_out/cancelled trigger
- `backend/apps/reservations/apps.py` — connect Booking post_save signal
- `backend/apps/berths/serializers.py` — expose `sales_channel`, `channel_cooldown_until`
- `backend/apps/berths/views.py` — add `IcalFeedView`, `SyncMySeaView`; update `BerthDetailView` cooldown
- `backend/apps/accounts/views.py` — add `ChannelSettingsView`
- `backend/apps/berths/urls.py` — wire new berth endpoints
- `backend/apps/accounts/urls.py` — wire `channel-settings/`
- `field/src/screens/field/ChannelManagementFlow.jsx` — new berth channel badge + toggle flow
- `field/src/screens/Field.jsx` — add Channel Management to action grid

---

## Task 1: Install icalendar + Database migrations

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/apps/accounts/models.py`
- Modify: `backend/apps/berths/models.py`
- Modify: `backend/apps/reservations/models.py`

- [ ] **Step 1: Add icalendar to requirements.txt**

Add after the last line:
```
icalendar>=5.0,<6.0
```

Install it:
```bash
cd backend
pip install icalendar>=5.0
```

- [ ] **Step 2: Add 4 fields to Marina model**

In `backend/apps/accounts/models.py`, add these fields to the `Marina` class before the `save()` method:

```python
    # mySea channel management
    auto_allocate_inventory = models.BooleanField(default=False)
    mysea_target_pct = models.IntegerField(default=20)
    mysea_ical_url = models.URLField(blank=True, default='')
    mysea_last_synced = models.DateTimeField(null=True, blank=True)
```

- [ ] **Step 3: Add 2 fields to Berth model**

In `backend/apps/berths/models.py`, add these fields to the `Berth` class after the `position_on_parent` field:

```python
    CHANNEL_CHOICES = [
        ('direct', 'Direct'),
        ('mysea',  'mySea'),
    ]
    sales_channel = models.CharField(
        max_length=20, choices=CHANNEL_CHOICES, default='direct'
    )
    channel_cooldown_until = models.DateTimeField(null=True, blank=True)
```

- [ ] **Step 4: Add 2 fields to Booking model**

In `backend/apps/reservations/models.py`, add these fields to the `Booking` class after `created_at`:

```python
    SOURCE_CHOICES = [
        ('direct', 'Direct'),
        ('mysea',  'mySea'),
    ]
    booking_source = models.CharField(
        max_length=20, choices=SOURCE_CHOICES, default='direct'
    )
    mysea_event_uid = models.CharField(max_length=255, blank=True, default='')
```

(`mysea_event_uid` stores the mySea iCal VEVENT UID for deduplication during inbound sync.)

- [ ] **Step 5: Generate and run migrations**

```bash
cd backend
python manage.py makemigrations accounts --name="marina_channel_fields"
python manage.py makemigrations berths --name="berth_channel_fields"
python manage.py makemigrations reservations --name="booking_source_uid"
python manage.py migrate
```

Expected output ends with: `Running migrations: OK`

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/apps/accounts/models.py backend/apps/berths/models.py backend/apps/reservations/models.py backend/apps/accounts/migrations/ backend/apps/berths/migrations/ backend/apps/reservations/migrations/
git commit -m "feat: add channel management fields to Marina, Berth, Booking"
```

---

## Task 2: Booking engine channel filters

**Files:**
- Modify: `backend/apps/reservations/booking_engine.py`
- Modify: `backend/apps/reservations/tests.py`

- [ ] **Step 1: Write failing tests**

Add to `backend/apps/reservations/tests.py` after the existing imports:

```python
class ChannelFilterTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.berth = make_berth(self.marina)
        self.check_in = datetime.date(2030, 7, 1)
        self.check_out = datetime.date(2030, 7, 5)

    def test_mysea_berth_excluded_from_direct_search(self):
        from apps.reservations.booking_engine import compatible_available_berths
        self.berth.sales_channel = 'mysea'
        self.berth.save(update_fields=['sales_channel'])
        qs = compatible_available_berths(self.marina, self.check_in, self.check_out)
        self.assertNotIn(self.berth, qs)

    def test_direct_berth_included_in_search(self):
        from apps.reservations.booking_engine import compatible_available_berths
        self.berth.sales_channel = 'direct'
        self.berth.save(update_fields=['sales_channel'])
        qs = compatible_available_berths(self.marina, self.check_in, self.check_out)
        self.assertIn(self.berth, qs)

    def test_cooldown_berth_excluded(self):
        from apps.reservations.booking_engine import compatible_available_berths
        self.berth.sales_channel = 'direct'
        self.berth.channel_cooldown_until = timezone.now() + datetime.timedelta(minutes=20)
        self.berth.save(update_fields=['sales_channel', 'channel_cooldown_until'])
        qs = compatible_available_berths(self.marina, self.check_in, self.check_out)
        self.assertNotIn(self.berth, qs)

    def test_expired_cooldown_berth_included(self):
        from apps.reservations.booking_engine import compatible_available_berths
        self.berth.sales_channel = 'direct'
        self.berth.channel_cooldown_until = timezone.now() - datetime.timedelta(minutes=1)
        self.berth.save(update_fields=['sales_channel', 'channel_cooldown_until'])
        qs = compatible_available_berths(self.marina, self.check_in, self.check_out)
        self.assertIn(self.berth, qs)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
python manage.py test apps.reservations.tests.ChannelFilterTest -v 2
```

Expected: 4 FAILs (channel field exists but filters not added yet)

- [ ] **Step 3: Add filters to compatible_available_berths**

In `backend/apps/reservations/booking_engine.py`, update `compatible_available_berths` — add two lines after `qs = Berth.objects.filter(marina=marina).exclude(status='maintenance')`:

```python
def compatible_available_berths(
    marina, check_in, check_out,
    boat_loa=None, boat_beam=None, boat_draft=None,
):
    qs = Berth.objects.filter(marina=marina).exclude(status='maintenance')
    qs = qs.filter(sales_channel='direct')
    qs = qs.exclude(channel_cooldown_until__gt=timezone.now())

    if boat_loa is not None:
        # ... rest of function unchanged
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend
python manage.py test apps.reservations.tests.ChannelFilterTest -v 2
```

Expected: 4 PASSes

- [ ] **Step 5: Commit**

```bash
git add backend/apps/reservations/booking_engine.py backend/apps/reservations/tests.py
git commit -m "feat: filter mysea and cooldown berths from direct booking engine"
```

---

## Task 3: Smart Allocator

**Files:**
- Create: `backend/apps/berths/allocator.py`
- Create: `backend/apps/berths/tests/test_allocator.py`

- [ ] **Step 1: Create test file**

Create `backend/apps/berths/tests/` directory if it doesn't exist. Check for `__init__.py`:

```bash
ls backend/apps/berths/tests/ 2>/dev/null || mkdir backend/apps/berths/tests && touch backend/apps/berths/tests/__init__.py
```

Create `backend/apps/berths/tests/test_allocator.py`:

```python
import datetime
from django.test import TestCase
from django.utils import timezone
from apps.accounts.models import Marina
from apps.berths.models import Berth, Pier
from apps.billing.models import ChargeableItem


def make_marina(**kwargs):
    return Marina.objects.create(name='Test Marina', **kwargs)


def make_berth(marina, code, channel='direct'):
    pier, _ = Pier.objects.get_or_create(marina=marina, code='A', defaults={'label': 'A'})
    tier, _ = ChargeableItem.objects.get_or_create(
        marina=marina, name='Night', defaults={'category': 'berth', 'pricing_model': 'per_night', 'unit_price': 50}
    )
    return Berth.objects.create(
        marina=marina, pier=pier, code=code, pricing_tier=tier,
        status='available', sales_channel=channel
    )


class RunSmartAllocatorTest(TestCase):
    def setUp(self):
        self.marina = make_marina(auto_allocate_inventory=True, mysea_target_pct=20)
        # 10 berths all direct
        self.berths = [make_berth(self.marina, f'B{i}', channel='direct') for i in range(10)]

    def test_freed_berth_assigned_mysea_when_under_target(self):
        from apps.berths.allocator import run_smart_allocator
        # target=20% of 10 = 2 mysea. currently 0 mysea → freed berth should go to mysea
        freed = self.berths[0]
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        self.assertEqual(freed.sales_channel, 'mysea')

    def test_freed_berth_stays_direct_when_at_target(self):
        from apps.berths.allocator import run_smart_allocator
        # Set 2 berths to mysea (20% of 10 = target met)
        self.berths[1].sales_channel = 'mysea'
        self.berths[1].save(update_fields=['sales_channel'])
        self.berths[2].sales_channel = 'mysea'
        self.berths[2].save(update_fields=['sales_channel'])
        freed = self.berths[0]
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        self.assertEqual(freed.sales_channel, 'direct')

    def test_noop_when_auto_allocate_disabled(self):
        from apps.berths.allocator import run_smart_allocator
        self.marina.auto_allocate_inventory = False
        self.marina.save(update_fields=['auto_allocate_inventory'])
        freed = self.berths[0]
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        self.assertEqual(freed.sales_channel, 'direct')  # unchanged

    def test_maintenance_berths_excluded_from_pool(self):
        from apps.berths.allocator import run_smart_allocator
        # 2 berths in maintenance → pool=8, target=20% of 8=2 mysea, current=0 → should allocate
        self.berths[8].status = 'maintenance'
        self.berths[8].save(update_fields=['status'])
        self.berths[9].status = 'maintenance'
        self.berths[9].save(update_fields=['status'])
        freed = self.berths[0]
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        self.assertEqual(freed.sales_channel, 'mysea')


class RebalanceDownTest(TestCase):
    def setUp(self):
        self.marina = make_marina(auto_allocate_inventory=True, mysea_target_pct=10)
        # 10 berths, 5 already mysea (but target is only 10% = 1)
        self.direct = [make_berth(self.marina, f'D{i}', channel='direct') for i in range(5)]
        self.mysea = [make_berth(self.marina, f'M{i}', channel='mysea') for i in range(5)]

    def test_rebalance_flips_excess_unoccupied_mysea_to_direct(self):
        from apps.berths.allocator import rebalance_down
        rebalance_down(self.marina)
        mysea_count = Berth.objects.filter(marina=self.marina, sales_channel='mysea').count()
        self.assertEqual(mysea_count, 1)  # 10% of 10 = 1

    def test_rebalance_leaves_occupied_mysea_berths_alone(self):
        from apps.berths.allocator import rebalance_down
        from apps.reservations.models import Booking
        # Occupy 3 of the 5 mysea berths with active bookings
        for berth in self.mysea[:3]:
            Booking.objects.create(
                marina=self.marina, berth=berth,
                check_in=datetime.date(2030, 1, 1), check_out=datetime.date(2030, 1, 5),
                nights=4, status='checked_in',
            )
        rebalance_down(self.marina)
        # Target=1, but 3 are occupied → can only free 2 unoccupied ones → mysea still has 3
        mysea_count = Berth.objects.filter(marina=self.marina, sales_channel='mysea').count()
        self.assertEqual(mysea_count, 3)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
python manage.py test apps.berths.tests.test_allocator -v 2
```

Expected: ImportError — `apps.berths.allocator` does not exist yet

- [ ] **Step 3: Create allocator.py**

Create `backend/apps/berths/allocator.py`:

```python
from apps.reservations.booking_engine import ACTIVE_STATUSES


def run_smart_allocator(marina, freed_berth):
    """
    Called when a berth is freed. If auto_allocate_inventory is on,
    assigns freed_berth to mysea or direct based on current vs target split.
    Uses .update() to avoid triggering post_save signals (prevents loops).
    """
    if not marina.auto_allocate_inventory:
        return

    from apps.berths.models import Berth

    total_pool = (
        Berth.objects.filter(marina=marina)
        .exclude(status='maintenance')
        .count()
    )
    if total_pool == 0:
        return

    current_mysea = (
        Berth.objects.filter(marina=marina, sales_channel='mysea')
        .exclude(status='maintenance')
        .count()
    )
    target_mysea = round(total_pool * marina.mysea_target_pct / 100)

    new_channel = 'mysea' if current_mysea < target_mysea else 'direct'
    Berth.objects.filter(pk=freed_berth.pk).update(sales_channel=new_channel)


def rebalance_down(marina):
    """
    Called when mysea_target_pct is lowered. Immediately flips unoccupied
    mySea berths back to direct until the current count meets the new target.
    Berths with active bookings are never touched.
    """
    from apps.berths.models import Berth
    from apps.reservations.models import Booking

    total_pool = (
        Berth.objects.filter(marina=marina)
        .exclude(status='maintenance')
        .count()
    )
    if total_pool == 0:
        return

    target_mysea = round(total_pool * marina.mysea_target_pct / 100)

    occupied_berth_ids = (
        Booking.objects.filter(marina=marina, status__in=ACTIVE_STATUSES)
        .exclude(berth__isnull=True)
        .values_list('berth_id', flat=True)
        .distinct()
    )

    # Unoccupied mySea berths, ordered by code for deterministic behaviour
    candidates = (
        Berth.objects.filter(marina=marina, sales_channel='mysea')
        .exclude(status='maintenance')
        .exclude(pk__in=occupied_berth_ids)
        .order_by('code')
    )

    current_mysea = (
        Berth.objects.filter(marina=marina, sales_channel='mysea')
        .exclude(status='maintenance')
        .count()
    )

    to_flip = max(0, current_mysea - target_mysea)
    ids_to_flip = list(candidates.values_list('pk', flat=True)[:to_flip])
    if ids_to_flip:
        Berth.objects.filter(pk__in=ids_to_flip).update(sales_channel='direct')
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend
python manage.py test apps.berths.tests.test_allocator -v 2
```

Expected: 7 PASSes

- [ ] **Step 5: Commit**

```bash
git add backend/apps/berths/allocator.py backend/apps/berths/tests/
git commit -m "feat: add smart allocator and rebalance_down"
```

---

## Task 4: Wire allocator into Django signals

**Files:**
- Modify: `backend/apps/reservations/receivers.py`
- Modify: `backend/apps/reservations/apps.py`
- Modify: `backend/apps/berths/signals.py`

- [ ] **Step 1: Add Booking post_save receiver**

Replace the full contents of `backend/apps/reservations/receivers.py`:

```python
from django.db.models.signals import post_save
from django.dispatch import receiver
from .models import Booking


def on_invoice_paid(sender, invoice, **kwargs):
    if invoice.source_type == 'berth_booking' and invoice.source_id:
        Booking.objects.filter(pk=invoice.source_id).update(status='confirmed')


@receiver(post_save, sender=Booking)
def on_booking_save(sender, instance, **kwargs):
    """
    When a booking is released (checked_out or cancelled) and has a berth,
    run the smart allocator to re-evaluate that berth's channel assignment.
    Only fires on status transitions that free a berth.
    """
    if instance.status not in ('checked_out', 'cancelled'):
        return
    if not instance.berth_id:
        return
    marina = instance.marina
    if not marina.auto_allocate_inventory:
        return
    from apps.berths.allocator import run_smart_allocator
    instance.berth.refresh_from_db(fields=['sales_channel', 'status'])
    run_smart_allocator(marina, instance.berth)
```

- [ ] **Step 2: Connect the signal in apps.py**

Update `backend/apps/reservations/apps.py`:

```python
from django.apps import AppConfig


class ReservationsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.reservations'

    def ready(self):
        from apps.billing.signals import invoice_paid
        from .receivers import on_invoice_paid, on_booking_save  # noqa: F401
        invoice_paid.connect(on_invoice_paid, dispatch_uid='reservations.on_invoice_paid')
        # on_booking_save is connected via @receiver decorator — importing it registers it
```

- [ ] **Step 3: Add maintenance→available trigger to berth signals**

Update `backend/apps/berths/signals.py`. Add the `pre_save` handler to capture previous status, then extend `on_berth_save`:

```python
from django.db.models.signals import pre_save, post_save
from django.dispatch import receiver


def _push_berth_update(berth):
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer
        channel_layer = get_channel_layer()
        if not channel_layer:
            return
        async_to_sync(channel_layer.group_send)(
            f'marina_{berth.marina_id}',
            {
                'type': 'berth_update',
                'data': {
                    'type': 'berth_update',
                    'berth_id': berth.id,
                    'status': berth.status,
                    'pier': berth.pier_id,
                    'local_x': str(berth.local_x) if berth.local_x is not None else None,
                    'local_y': str(berth.local_y) if berth.local_y is not None else None,
                },
            }
        )
    except Exception:
        pass  # never crash a save because of a push failure


@receiver(pre_save, sender='berths.Berth')
def on_berth_pre_save(sender, instance, **kwargs):
    """Capture previous status so post_save can detect maintenance→available transitions."""
    if instance.pk:
        from apps.berths.models import Berth
        prev = Berth.objects.filter(pk=instance.pk).values_list('status', flat=True).first()
        instance._prev_status = prev
    else:
        instance._prev_status = None


@receiver(post_save, sender='berths.Berth')
def on_berth_save(sender, instance, created, **kwargs):
    _push_berth_update(instance)

    # When a berth comes out of maintenance, run allocator to assign it a channel
    update_fields = kwargs.get('update_fields')
    if update_fields and 'sales_channel' in update_fields:
        return  # this was an allocator .update() via save() — skip to avoid loops
    prev = getattr(instance, '_prev_status', None)
    if prev == 'maintenance' and instance.status != 'maintenance':
        marina = instance.marina
        if marina.auto_allocate_inventory:
            from apps.berths.allocator import run_smart_allocator
            run_smart_allocator(marina, instance)
```

- [ ] **Step 4: Verify no regressions**

```bash
cd backend
python manage.py test apps.reservations apps.berths -v 2
```

Expected: all existing + new tests pass, no errors

- [ ] **Step 5: Commit**

```bash
git add backend/apps/reservations/receivers.py backend/apps/reservations/apps.py backend/apps/berths/signals.py
git commit -m "feat: wire smart allocator into booking and berth post-save signals"
```

---

## Task 5: Outbound iCal feed

**Files:**
- Create: `backend/apps/berths/ical.py`
- Create: `backend/apps/berths/tests/test_ical.py`
- Modify: `backend/apps/berths/views.py`
- Modify: `backend/apps/berths/urls.py`

- [ ] **Step 1: Write failing test**

Create `backend/apps/berths/tests/test_ical.py`:

```python
import datetime
from django.test import TestCase
from django.utils import timezone
from apps.accounts.models import Marina
from apps.berths.models import Berth, Pier
from apps.billing.models import ChargeableItem
from apps.reservations.models import Booking


def make_marina():
    return Marina.objects.create(name='Test Marina')


def make_berth(marina, code, channel='mysea'):
    pier, _ = Pier.objects.get_or_create(marina=marina, code='A', defaults={'label': 'A'})
    tier, _ = ChargeableItem.objects.get_or_create(
        marina=marina, name='Night',
        defaults={'category': 'berth', 'pricing_model': 'per_night', 'unit_price': 50}
    )
    return Berth.objects.create(
        marina=marina, pier=pier, code=code, pricing_tier=tier,
        status='available', sales_channel=channel
    )


class OutboundIcalTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.berth = make_berth(self.marina, 'A1', channel='mysea')

    def test_active_booking_appears_as_vevent(self):
        from apps.berths.ical import generate_mysea_ical
        booking = Booking.objects.create(
            marina=self.marina, berth=self.berth,
            check_in=datetime.date(2030, 7, 1),
            check_out=datetime.date(2030, 7, 5),
            nights=4, status='confirmed', booking_source='mysea',
            guest_name='J. Smith',
        )
        cal_str = generate_mysea_ical(self.marina)
        self.assertIn(b'VEVENT', cal_str)
        self.assertIn(b'20300701', cal_str)
        self.assertIn(b'DTSTAMP', cal_str)

    def test_direct_booking_excluded(self):
        from apps.berths.ical import generate_mysea_ical
        direct_berth = make_berth(self.marina, 'B1', channel='direct')
        Booking.objects.create(
            marina=self.marina, berth=direct_berth,
            check_in=datetime.date(2030, 7, 1),
            check_out=datetime.date(2030, 7, 5),
            nights=4, status='confirmed', booking_source='direct',
        )
        cal_str = generate_mysea_ical(self.marina)
        self.assertNotIn(b'VEVENT', cal_str)

    def test_cooldown_berth_generates_blocking_event(self):
        from apps.berths.ical import generate_mysea_ical
        self.berth.channel_cooldown_until = timezone.now() + datetime.timedelta(minutes=25)
        self.berth.save(update_fields=['channel_cooldown_until'])
        cal_str = generate_mysea_ical(self.marina)
        self.assertIn(b'VEVENT', cal_str)
        self.assertIn(b'cooldown', cal_str.lower())

    def test_ical_endpoint_returns_200(self):
        response = self.client.get(f'/api/v1/berths/ical/mysea.ics?marina={self.marina.slug}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'text/calendar; charset=utf-8')
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
python manage.py test apps.berths.tests.test_ical -v 2
```

Expected: ImportError / 404 errors

- [ ] **Step 3: Create ical.py**

Create `backend/apps/berths/ical.py`:

```python
from datetime import timedelta
from django.utils import timezone
from icalendar import Calendar, Event

from apps.reservations.booking_engine import ACTIVE_STATUSES


def generate_mysea_ical(marina) -> bytes:
    """
    Generate an RFC 5545 iCalendar feed of all blocked dates on mySea-allocated berths.
    Includes:
    - Active bookings on mysea berths
    - Cooldown blocking events for berths in transition
    Returns bytes (UTF-8 encoded .ics content).
    """
    from apps.berths.models import Berth
    from apps.reservations.models import Booking

    now = timezone.now()
    cal = Calendar()
    cal.add('prodid', '-//DocksBase//mySea Channel Feed//EN')
    cal.add('version', '2.0')
    cal.add('calscale', 'GREGORIAN')
    cal.add('method', 'PUBLISH')

    # Active bookings on mySea-allocated berths
    bookings = (
        Booking.objects.filter(
            marina=marina,
            berth__sales_channel='mysea',
            status__in=ACTIVE_STATUSES,
        )
        .select_related('berth')
    )

    for booking in bookings:
        event = Event()
        event.add('uid', f'booking-{booking.pk}@docksbase')
        event.add('dtstamp', now)
        event.add('dtstart', booking.check_in)
        event.add('dtend', booking.check_out)
        summary = booking.guest_name or f'LOA {booking.boat_loa}m' if booking.boat_loa else 'Reserved'
        event.add('summary', summary)
        cal.add_component(event)

    # Cooldown blocking events (berths in 30-min transition limbo)
    cooling_berths = Berth.objects.filter(
        marina=marina,
        channel_cooldown_until__gt=now,
    )
    for berth in cooling_berths:
        event = Event()
        event.add('uid', f'cooldown-{berth.pk}@docksbase')
        event.add('dtstamp', now)
        # Block from now until cooldown expires
        event.add('dtstart', now.date())
        event.add('dtend', berth.channel_cooldown_until.date() + timedelta(days=1))
        event.add('summary', f'Cooldown — Berth {berth.code}')
        cal.add_component(event)

    return cal.to_ical()
```

- [ ] **Step 4: Add IcalFeedView to views.py**

In `backend/apps/berths/views.py`, add to the top-level imports and add the view class at the end of the file:

```python
# Add to existing imports at top:
from django.http import HttpResponse

# Add view class at the bottom:
class IcalFeedView(APIView):
    permission_classes = []  # public — the URL slug is the secret

    def get(self, request):
        from apps.accounts.models import Marina
        from .ical import generate_mysea_ical

        slug = request.query_params.get('marina', '')
        try:
            marina = Marina.objects.get(slug=slug)
        except Marina.DoesNotExist:
            return Response({'detail': 'Marina not found.'}, status=404)

        ical_bytes = generate_mysea_ical(marina)
        return HttpResponse(
            ical_bytes,
            content_type='text/calendar; charset=utf-8',
            headers={'Content-Disposition': 'attachment; filename="mysea.ics"'},
        )
```

- [ ] **Step 5: Add URL**

In `backend/apps/berths/urls.py`, add the import and path:

```python
from .views import (
    PierListCreateView, PierDetailView,
    BerthListCreateView, BerthDetailView,
    MapConfigView,
    BulkCreateBerthsView,
    BulkUpdateBerthPricingView,
    BroadcastSMSView,
    AmenityListCreateView, AmenityDetailView,
    IcalFeedView,
)

urlpatterns = [
    # ... existing paths ...
    path('berths/ical/mysea.ics', IcalFeedView.as_view(), name='berths_ical_mysea'),
]
```

- [ ] **Step 6: Run tests**

```bash
cd backend
python manage.py test apps.berths.tests.test_ical -v 2
```

Expected: 4 PASSes

- [ ] **Step 7: Commit**

```bash
git add backend/apps/berths/ical.py backend/apps/berths/views.py backend/apps/berths/urls.py backend/apps/berths/tests/test_ical.py
git commit -m "feat: add outbound mySea iCal feed endpoint"
```

---

## Task 6: Channel Settings API

**Files:**
- Modify: `backend/apps/accounts/views.py`
- Modify: `backend/apps/accounts/urls.py`

- [ ] **Step 1: Add ChannelSettingsView to accounts/views.py**

Add at the end of `backend/apps/accounts/views.py`:

```python
class ChannelSettingsView(APIView):
    """
    PATCH /auth/marina/channel-settings/
    Update auto_allocate_inventory, mysea_target_pct, mysea_ical_url.
    If mysea_target_pct is lowered, immediately rebalances unoccupied mySea berths.
    """
    def patch(self, request):
        marina = request.user.marina
        old_target = marina.mysea_target_pct

        allowed = {'auto_allocate_inventory', 'mysea_target_pct', 'mysea_ical_url'}
        data = {k: v for k, v in request.data.items() if k in allowed}

        if 'mysea_target_pct' in data:
            pct = data['mysea_target_pct']
            if not isinstance(pct, int) or not (0 <= pct <= 100):
                return Response(
                    {'mysea_target_pct': 'Must be an integer between 0 and 100.'},
                    status=400,
                )

        for field, value in data.items():
            setattr(marina, field, value)
        marina.save(update_fields=list(data.keys()))

        # Rebalance immediately if target was lowered
        new_target = marina.mysea_target_pct
        if 'mysea_target_pct' in data and new_target < old_target:
            from apps.berths.allocator import rebalance_down
            rebalance_down(marina)

        return Response({
            'auto_allocate_inventory': marina.auto_allocate_inventory,
            'mysea_target_pct': marina.mysea_target_pct,
            'mysea_ical_url': marina.mysea_ical_url,
            'mysea_last_synced': marina.mysea_last_synced,
        })
```

- [ ] **Step 2: Add URL**

In `backend/apps/accounts/urls.py`, add the import and path:

```python
from .views import (
    LoginView, MeView, SendMagicLinkView, ExchangeMagicTokenView,
    SignupView, VerifyEmailView, ResendVerificationView, OnboardingView,
    ChannelSettingsView,
)

urlpatterns = [
    # ... existing paths ...
    path('marina/channel-settings/', ChannelSettingsView.as_view(), name='channel_settings'),
]
```

- [ ] **Step 3: Write and run tests**

Add to `backend/apps/accounts/tests/` (or create `test_channel_settings.py`):

```python
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.berths.models import Berth, Pier
from apps.billing.models import ChargeableItem


def make_setup():
    marina = Marina.objects.create(name='Test Marina', auto_allocate_inventory=True, mysea_target_pct=50)
    user = User.objects.create_user(email='mgr@test.com', password='pass', marina=marina, role='manager')
    pier = Pier.objects.create(marina=marina, code='A', label='A')
    tier = ChargeableItem.objects.create(
        marina=marina, name='Night', category='berth', pricing_model='per_night', unit_price=50
    )
    berths = [
        Berth.objects.create(marina=marina, pier=pier, code=f'B{i}', pricing_tier=tier,
                              status='available', sales_channel='mysea')
        for i in range(4)
    ] + [
        Berth.objects.create(marina=marina, pier=pier, code=f'D{i}', pricing_tier=tier,
                              status='available', sales_channel='direct')
        for i in range(4)
    ]
    return marina, user, berths


class ChannelSettingsViewTest(TestCase):
    def setUp(self):
        self.marina, self.user, self.berths = make_setup()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_patch_updates_target(self):
        resp = self.client.patch('/api/v1/auth/marina/channel-settings/', {'mysea_target_pct': 25}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.marina.refresh_from_db()
        self.assertEqual(self.marina.mysea_target_pct, 25)

    def test_lowering_target_triggers_rebalance(self):
        # marina has 4 mysea out of 8 total = 50%. Lower to 0% → all should flip to direct
        resp = self.client.patch('/api/v1/auth/marina/channel-settings/', {'mysea_target_pct': 0}, format='json')
        self.assertEqual(resp.status_code, 200)
        mysea_count = Berth.objects.filter(marina=self.marina, sales_channel='mysea').count()
        self.assertEqual(mysea_count, 0)

    def test_invalid_pct_rejected(self):
        resp = self.client.patch('/api/v1/auth/marina/channel-settings/', {'mysea_target_pct': 150}, format='json')
        self.assertEqual(resp.status_code, 400)
```

```bash
cd backend
python manage.py test apps.accounts -v 2
```

Expected: new tests pass, no regressions

- [ ] **Step 4: Commit**

```bash
git add backend/apps/accounts/views.py backend/apps/accounts/urls.py
git commit -m "feat: add channel settings API with auto-rebalance on target reduction"
```

---

## Task 7: Berth cooldown on manual channel override

**Files:**
- Modify: `backend/apps/berths/serializers.py`
- Modify: `backend/apps/berths/views.py`

- [ ] **Step 1: Add sales_channel and channel_cooldown_until to BerthSerializer**

In `backend/apps/berths/serializers.py`, update the `BerthSerializer`:

Add `'sales_channel', 'channel_cooldown_until'` to the `fields` list:

```python
    class Meta:
        model = Berth
        fields = [
            'id', 'code', 'berth_type', 'berth_class', 'operational_type',
            'pier', 'pier_code', 'side', 'position_index',
            'length_m', 'max_draft_m', 'max_beam_m', 'amenities',
            'pricing_tier', 'pricing_tier_name', 'pricing_tier_unit_price',
            'status', 'effective_status', 'vessel', 'vessel_name',
            'local_x', 'local_y', 'position_on_parent', 'is_placed',
            'sales_channel', 'channel_cooldown_until',
        ]
        read_only_fields = [
            'id', 'pier_code', 'vessel_name', 'is_placed', 'effective_status',
            'channel_cooldown_until',
        ]
```

(`channel_cooldown_until` is read-only in the serializer — it is set automatically by the view, never by the client.)

- [ ] **Step 2: Override update() in BerthDetailView to set cooldown**

In `backend/apps/berths/views.py`, find `BerthDetailView` and add a `perform_update` override. First, read the current view to find its exact definition, then add:

```python
class BerthDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = BerthSerializer

    def get_queryset(self):
        return Berth.objects.filter(marina=self.request.user.marina)

    def perform_update(self, serializer):
        from django.utils import timezone
        from datetime import timedelta

        instance = self.get_object()
        new_channel = serializer.validated_data.get('sales_channel')

        if new_channel and new_channel != instance.sales_channel:
            serializer.save(
                channel_cooldown_until=timezone.now() + timedelta(minutes=30)
            )
        else:
            serializer.save()
```

- [ ] **Step 3: Write and run test**

Add to `backend/apps/berths/tests/test_allocator.py`:

```python
from rest_framework.test import APIClient
from django.utils import timezone


class BerthCooldownTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user_obj = Marina.objects  # placeholder
        from apps.accounts.models import User
        self.user = User.objects.create_user(
            email='staff@test.com', password='pass', marina=self.marina, role='manager'
        )
        self.berth = make_berth(self.marina, 'C1', channel='direct')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_channel_change_sets_cooldown(self):
        resp = self.client.patch(
            f'/api/v1/berths/{self.berth.pk}/',
            {'sales_channel': 'mysea'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.berth.refresh_from_db()
        self.assertEqual(self.berth.sales_channel, 'mysea')
        self.assertIsNotNone(self.berth.channel_cooldown_until)
        self.assertGreater(self.berth.channel_cooldown_until, timezone.now())

    def test_non_channel_update_does_not_set_cooldown(self):
        resp = self.client.patch(
            f'/api/v1/berths/{self.berth.pk}/',
            {'status': 'maintenance'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.berth.refresh_from_db()
        self.assertIsNone(self.berth.channel_cooldown_until)
```

```bash
cd backend
python manage.py test apps.berths.tests.test_allocator.BerthCooldownTest -v 2
```

Expected: 2 PASSes

- [ ] **Step 4: Commit**

```bash
git add backend/apps/berths/serializers.py backend/apps/berths/views.py
git commit -m "feat: expose sales_channel on berth API; set 30min cooldown on manual channel change"
```

---

## Task 8: Inbound sync management command + trigger endpoint

**Files:**
- Create: `backend/apps/reservations/management/commands/sync_mysea_bookings.py`
- Modify: `backend/apps/berths/views.py`
- Modify: `backend/apps/berths/urls.py`

- [ ] **Step 1: Create sync_mysea_bookings management command**

Create `backend/apps/reservations/management/commands/sync_mysea_bookings.py`:

```python
"""
sync_mysea_bookings — run every 10 minutes via cron.

Fetches the mySea iCal feed for each marina that has mysea_ical_url set,
parses each VEVENT, and creates/updates Booking records with booking_source='mysea'.

Deduplication: by mysea_event_uid (the VEVENT UID from the mySea feed).
Berth assignment: match by length_m >= boat_loa if parseable from SUMMARY,
otherwise first free mySea berth ordered by code.

Usage:
  python manage.py sync_mysea_bookings
  python manage.py sync_mysea_bookings --marina-slug=port-de-nice
  python manage.py sync_mysea_bookings --dry-run
"""

import re
from datetime import date, timedelta

import requests
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from icalendar import Calendar

from apps.reservations.booking_engine import ACTIVE_STATUSES


def _parse_date(dt_value):
    """Convert icalendar date/datetime to Python date."""
    if hasattr(dt_value, 'dt'):
        val = dt_value.dt
    else:
        val = dt_value
    if hasattr(val, 'date'):
        return val.date()
    return val


def _parse_loa_from_summary(summary: str):
    """Try to extract boat LOA from SUMMARY strings like 'LOA 12.5m'."""
    match = re.search(r'LOA\s+([\d.]+)', summary or '', re.IGNORECASE)
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            pass
    return None


def _find_free_mysea_berth(marina, check_in, check_out, boat_loa=None):
    """Return the first free mySea berth for the given dates, optionally filtered by LOA."""
    from apps.berths.models import Berth
    from apps.reservations.models import Booking

    blocked_ids = (
        Booking.objects.filter(
            marina=marina,
            berth__isnull=False,
            status__in=ACTIVE_STATUSES,
            check_in__lt=check_out,
            check_out__gt=check_in,
        )
        .values_list('berth_id', flat=True)
        .distinct()
    )

    qs = Berth.objects.filter(
        marina=marina,
        sales_channel='mysea',
    ).exclude(
        status='maintenance',
    ).exclude(
        pk__in=blocked_ids,
    ).order_by('code')

    if boat_loa is not None:
        qs = qs.filter(length_m__gte=boat_loa)

    return qs.first()


def sync_marina(marina, dry=False, stdout=None):
    from apps.reservations.models import Booking

    if not marina.mysea_ical_url:
        return 0

    try:
        resp = requests.get(marina.mysea_ical_url, timeout=15)
        resp.raise_for_status()
    except Exception as exc:
        if stdout:
            stdout.write(f'  ERROR fetching feed for {marina.slug}: {exc}')
        return 0

    try:
        cal = Calendar.from_ical(resp.content)
    except Exception as exc:
        if stdout:
            stdout.write(f'  ERROR parsing iCal for {marina.slug}: {exc}')
        return 0

    created = updated = 0

    with transaction.atomic():
        for component in cal.walk():
            if component.name != 'VEVENT':
                continue

            uid = str(component.get('UID', ''))
            if not uid:
                continue

            try:
                check_in = _parse_date(component['DTSTART'])
                check_out = _parse_date(component['DTEND'])
            except (KeyError, AttributeError):
                continue

            if not isinstance(check_in, date) or not isinstance(check_out, date):
                continue
            if check_out <= check_in:
                continue

            summary = str(component.get('SUMMARY', ''))
            boat_loa = _parse_loa_from_summary(summary)

            existing = Booking.objects.filter(
                marina=marina,
                booking_source='mysea',
                mysea_event_uid=uid,
            ).first()

            if existing:
                if existing.check_in != check_in or existing.check_out != check_out:
                    if not dry:
                        existing.check_in = check_in
                        existing.check_out = check_out
                        existing.nights = (check_out - check_in).days or 1
                        existing.save(update_fields=['check_in', 'check_out', 'nights'])
                    updated += 1
                    if stdout:
                        stdout.write(f'  Updated booking {existing.pk} (uid={uid})')
                continue

            # New booking
            berth = _find_free_mysea_berth(marina, check_in, check_out, boat_loa)
            if berth is None:
                if stdout:
                    stdout.write(f'  WARNING: No free mySea berth for {check_in}–{check_out} (uid={uid})')
                continue

            nights = (check_out - check_in).days or 1
            if not dry:
                Booking.objects.create(
                    marina=marina,
                    berth=berth,
                    check_in=check_in,
                    check_out=check_out,
                    nights=nights,
                    status='confirmed',
                    paid=True,
                    booking_source='mysea',
                    mysea_event_uid=uid,
                    guest_name=summary[:200] if summary else '',
                    boat_loa=boat_loa,
                )
            created += 1
            if stdout:
                stdout.write(f'  Created booking for {check_in}–{check_out} berth={berth.code} (uid={uid})')

        if not dry:
            marina.mysea_last_synced = timezone.now()
            marina.save(update_fields=['mysea_last_synced'])

    return created + updated


class Command(BaseCommand):
    help = 'Sync mySea bookings from iCal feeds for all marinas with mysea_ical_url set'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--marina-slug', default='')

    def handle(self, *args, **options):
        from apps.accounts.models import Marina

        dry = options['dry_run']
        slug = options['marina_slug']

        qs = Marina.objects.exclude(mysea_ical_url='')
        if slug:
            qs = qs.filter(slug=slug)

        total = 0
        for marina in qs:
            prefix = '[DRY] ' if dry else ''
            self.stdout.write(f'{prefix}Syncing {marina.slug}…')
            count = sync_marina(marina, dry=dry, stdout=self.stdout)
            total += count
            self.stdout.write(f'  {count} events processed.')

        self.stdout.write(f'Done. Total: {total}')
```

- [ ] **Step 2: Add SyncMySeaView**

In `backend/apps/berths/views.py`, add at the bottom:

```python
class SyncMySeaView(APIView):
    """POST /berths/sync-mysea/ — manually trigger inbound iCal sync for this marina."""

    def post(self, request):
        from apps.reservations.management.commands.sync_mysea_bookings import sync_marina
        marina = request.user.marina
        if not marina.mysea_ical_url:
            return Response({'detail': 'No mySea iCal URL configured.'}, status=400)
        count = sync_marina(marina, dry=False, stdout=None)
        marina.refresh_from_db(fields=['mysea_last_synced'])
        return Response({'synced': count, 'last_synced': marina.mysea_last_synced})
```

- [ ] **Step 3: Add URL**

In `backend/apps/berths/urls.py`, add `SyncMySeaView` to imports and urls:

```python
from .views import (
    PierListCreateView, PierDetailView,
    BerthListCreateView, BerthDetailView,
    MapConfigView,
    BulkCreateBerthsView,
    BulkUpdateBerthPricingView,
    BroadcastSMSView,
    AmenityListCreateView, AmenityDetailView,
    IcalFeedView,
    SyncMySeaView,
)

urlpatterns = [
    # ... existing paths ...
    path('berths/ical/mysea.ics', IcalFeedView.as_view(), name='berths_ical_mysea'),
    path('berths/sync-mysea/', SyncMySeaView.as_view(), name='berths_sync_mysea'),
]
```

- [ ] **Step 4: Smoke-test the management command**

```bash
cd backend
python manage.py sync_mysea_bookings --dry-run
```

Expected output: `Done. Total: 0` (no marinas have mysea_ical_url yet)

- [ ] **Step 5: Run full test suite**

```bash
cd backend
python manage.py test apps -v 1
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add backend/apps/reservations/management/commands/sync_mysea_bookings.py backend/apps/berths/views.py backend/apps/berths/urls.py
git commit -m "feat: add inbound mySea iCal sync command and manual trigger endpoint"
```

---

## Task 9: Field app — Channel Management flow

**Files:**
- Create: `field/src/screens/field/ChannelManagementFlow.jsx`
- Modify: `field/src/screens/Field.jsx`

- [ ] **Step 1: Create ChannelManagementFlow.jsx**

Create `field/src/screens/field/ChannelManagementFlow.jsx`:

```jsx
import { useState, useEffect } from 'react';
import api from '../../api.js';

const HDR = { background: '#1a2d4a', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44 };
const CARD = { background: '#fff', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' };

const BADGE = {
  direct: { background: '#e8f4ea', color: '#1a6b2e', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none' },
  mysea:  { background: '#e8eef9', color: '#1a3c7e', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none' },
  cooldown: { background: '#f4f0e8', color: '#8a6d2e', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 600, cursor: 'default', border: 'none' },
};

function isCoolingDown(berth) {
  if (!berth.channel_cooldown_until) return false;
  return new Date(berth.channel_cooldown_until) > new Date();
}

export default function ChannelManagementFlow({ onBack }) {
  const [berths, setBerths] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null); // berth id being saved
  const [confirm, setConfirm] = useState(null); // { berth, newChannel }
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/berths/')
      .then(r => setBerths((r.data.results ?? r.data).filter(b => b.berth_class === 'standard')))
      .catch(() => setError('Failed to load berths.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleConfirm() {
    const { berth, newChannel } = confirm;
    setConfirm(null);
    setSaving(berth.id);
    try {
      const resp = await api.patch(`/berths/${berth.id}/`, { sales_channel: newChannel });
      setBerths(prev => prev.map(b => b.id === berth.id ? { ...b, ...resp.data } : b));
    } catch {
      setError('Failed to update berth channel.');
    } finally {
      setSaving(null);
    }
  }

  const channelLabel = ch => ch === 'mysea' ? 'mySea' : 'Direct';

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={HDR}>
        <button style={BACK_BTN} onClick={onBack}>←</button>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Channel Management</span>
      </div>

      {confirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, maxWidth: 340, width: '100%' }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Move Berth {confirm.berth.code}?</div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 20 }}>
              Moving to <strong>{channelLabel(confirm.newChannel)}</strong>. This berth will be unavailable on both channels for 30 minutes while the transition completes.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirm(null)} style={{ flex: 1, height: 44, borderRadius: 10, border: '1.5px solid #ddd', background: '#fff', fontSize: 14, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleConfirm} style={{ flex: 1, height: 44, borderRadius: 10, border: 'none', background: '#1a2d4a', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
      ) : error ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#c0392b', fontSize: 14 }}>{error}</div>
      ) : (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {berths.map(b => {
            const cooling = isCoolingDown(b);
            const badgeStyle = cooling ? BADGE.cooldown : BADGE[b.sales_channel] ?? BADGE.direct;
            const label = cooling ? '⏳ Cooldown' : channelLabel(b.sales_channel);
            return (
              <div key={b.id} style={CARD}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Berth {b.code}</div>
                  {b.pier_code && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>Pier {b.pier_code}</div>}
                </div>
                <button
                  style={{ ...badgeStyle, opacity: saving === b.id ? 0.5 : 1 }}
                  disabled={cooling || saving === b.id}
                  onClick={() => !cooling && setConfirm({ berth: b, newChannel: b.sales_channel === 'mysea' ? 'direct' : 'mysea' })}
                >
                  {saving === b.id ? '…' : label}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add Channel Management to Field.jsx action grid**

In `field/src/screens/Field.jsx`, add the import and action button. Find the existing imports at the top and add:

```jsx
import ChannelManagementFlow from './field/ChannelManagementFlow';
```

In the action grid section, add a new grid item alongside the existing ones:

```jsx
{ icon: '⚓', label: 'Channels', flow: 'channels' },
```

In the flow rendering switch/conditional, add:

```jsx
if (flow === 'channels') return <ChannelManagementFlow onBack={() => setFlow(null)} />;
```

- [ ] **Step 3: Start dev server and verify**

```bash
cd DocksBase_ManagementSystem/field
npm install
npm run dev
```

Open `http://localhost:<port>`, log in as staff, verify:
- "Channels" action appears in the action grid
- Tapping it shows the berth list with Direct/mySea badges
- Tapping a badge shows the 30-minute cooldown confirmation modal
- Confirming updates the badge and shows cooldown state

- [ ] **Step 4: Commit**

```bash
git add field/src/screens/field/ChannelManagementFlow.jsx field/src/screens/Field.jsx
git commit -m "feat: add channel management flow to field app with cooldown confirmation"
```

---

---

## Task 10: Management frontend — Channel Management settings panel

**Files:**
- Modify: `frontend/src/screens/Settings.jsx`
- Modify: `backend/apps/accounts/serializers.py` (expose new Marina fields)

- [ ] **Step 1: Expose new Marina fields in MarinaSerializer**

In `backend/apps/accounts/serializers.py`, find the `MarinaSerializer` fields list and add the four new channel fields:

```python
# Add to the Marina serializer fields list:
'auto_allocate_inventory',
'mysea_target_pct',
'mysea_ical_url',
'mysea_last_synced',
```

`mysea_last_synced` should be read-only. Add it to `read_only_fields` if that list exists, or use `serializers.DateTimeField(read_only=True, allow_null=True)` explicitly.

- [ ] **Step 2: Add channel settings state to Settings.jsx**

In `frontend/src/screens/Settings.jsx`, add state initialization in the main component after the existing `flags` state:

```jsx
// Channel management state
const [cs, setCs] = useState({ auto_allocate_inventory: false, mysea_target_pct: 20, mysea_ical_url: '' });
const [csSaving, setCsSaving] = useState(false);
const [csSyncing, setCsSyncing] = useState(false);
const [csLastSynced, setCsLastSynced] = useState(null);
```

Populate from marina in the existing `useEffect` that initializes `mf` and `flags`. Add after `setFlags(...)`:

```jsx
setCs({
  auto_allocate_inventory: marina.auto_allocate_inventory ?? false,
  mysea_target_pct:        marina.mysea_target_pct        ?? 20,
  mysea_ical_url:          marina.mysea_ical_url          ?? '',
});
setCsLastSynced(marina.mysea_last_synced ?? null);
```

- [ ] **Step 3: Add save and sync handlers**

Add these two functions after `saveFlags()`:

```jsx
async function saveChannelSettings() {
  setCsSaving(true);
  try {
    const { data } = await api.patch('/auth/marina/channel-settings/', {
      auto_allocate_inventory: cs.auto_allocate_inventory,
      mysea_target_pct: cs.mysea_target_pct,
      mysea_ical_url: cs.mysea_ical_url,
    });
    setCsLastSynced(data.mysea_last_synced);
  } finally {
    setCsSaving(false);
  }
}

async function triggerMySeaSync() {
  setCsSyncing(true);
  try {
    const { data } = await api.post('/berths/sync-mysea/');
    setCsLastSynced(data.last_synced);
  } catch {
    // sync failed — surface nothing, last_synced won't update
  } finally {
    setCsSyncing(false);
  }
}
```

- [ ] **Step 4: Add Channel Management card to System tab**

In the `{tab === 'system' && ...}` section, inside the left column `div` (after the Feature Flags card, before the closing `</div>`), add:

```jsx
{/* Channel Management — mySea integration */}
<div className="card">
  <div className="card-header">
    <div className="card-header-title">Channel Management</div>
    <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>mySea OTA inventory allocation</div>
  </div>
  <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg)', borderRadius: 7 }}>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 500 }}>Automatic allocation</div>
        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>
          Automatically assign freed berths to mySea based on target %
        </div>
      </div>
      <Toggle
        on={cs.auto_allocate_inventory}
        onChange={v => setCs(c => ({ ...c, auto_allocate_inventory: v }))}
      />
    </div>

    {cs.auto_allocate_inventory && (
      <FieldRow
        label="mySea target %"
        hint={`Direct: ${100 - cs.mysea_target_pct}% · mySea: ${cs.mysea_target_pct}%`}
      >
        <input
          type="range" min={0} max={50} step={5}
          value={cs.mysea_target_pct}
          onChange={e => setCs(c => ({ ...c, mysea_target_pct: Number(e.target.value) }))}
          style={{ width: '100%' }}
        />
      </FieldRow>
    )}

    <FieldRow label="mySea iCal feed URL" hint="Paste the iCal URL from your mySea extranet">
      <input
        type="url"
        value={cs.mysea_ical_url}
        onChange={e => setCs(c => ({ ...c, mysea_ical_url: e.target.value }))}
        placeholder="https://www.mysea.app/calendar/..."
      />
    </FieldRow>

    {csLastSynced && (
      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>
        Last synced: {new Date(csLastSynced).toLocaleString()}
      </div>
    )}

    <div style={{ display: 'flex', gap: 8 }}>
      <button
        className="btn btn-primary btn-sm"
        disabled={csSaving || marinaLoading}
        onClick={saveChannelSettings}
      >
        {csSaving ? 'Saving…' : 'Save'}
      </button>
      {cs.mysea_ical_url && (
        <button
          className="btn btn-ghost btn-sm"
          disabled={csSyncing}
          onClick={triggerMySeaSync}
        >
          {csSyncing ? 'Syncing…' : 'Sync now'}
        </button>
      )}
    </div>
  </div>
</div>
```

- [ ] **Step 5: Start dev server and verify**

```bash
cd DocksBase_ManagementSystem/frontend
npm run dev
```

Navigate to Settings → System tab. Verify:
- "Channel Management" card appears
- Toggle switches `auto_allocate_inventory` on/off
- Slider appears when toggle is on
- "Sync now" button appears only when iCal URL is entered
- Save calls `PATCH /auth/marina/channel-settings/`
- Sync now calls `POST /berths/sync-mysea/`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/Settings.jsx backend/apps/accounts/serializers.py
git commit -m "feat: add channel management settings panel to Settings screen"
```

---

## Cron Setup Note

The `sync_mysea_bookings` command needs to run every 10 minutes in production. Add to the server's crontab:

```
*/10 * * * * cd /path/to/backend && python manage.py sync_mysea_bookings >> /var/log/mysea_sync.log 2>&1
```

This is a deployment concern and not part of this implementation plan.

# Channels Screen & OTA Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded mySea channel system with a generic OTA Connections framework and add a new top-level Channels screen with booking pipeline toggle, per-connection allocator, and per-berth assignment grid.

**Architecture:** `OTAConnection` model (in `berths` app) replaces Marina-level `mysea_*` fields. `Berth.sales_channel` CharField and `channel_cooldown_until` are replaced by `ota_connection` FK (null = direct) and `channel_locked` BooleanField. The allocator is rewritten to loop over all marina connections. A new `Channels` screen is added as a top-level nav item. The cooldown concept is dropped — manual assignment = permanent lock until explicitly unlocked.

**Tech Stack:** Django/DRF (backend), React (frontend), existing `icalendar` package

---

## File Map

**Create:**
- `backend/apps/berths/tests/test_ota_connection.py`
- `frontend/src/screens/Channels.jsx`
- `frontend/src/hooks/useOTAConnections.js`

**Modify:**
- `backend/apps/berths/models.py` — add `OTAConnection`; update `Berth` (add `ota_connection` FK + `channel_locked`; remove `sales_channel`, `channel_cooldown_until`)
- `backend/apps/berths/allocator.py` — rewrite for multi-connection
- `backend/apps/berths/ical.py` — token-based URL, per-connection feed
- `backend/apps/berths/serializers.py` — swap channel fields
- `backend/apps/berths/signals.py` — remove `channel_cooldown_until` references
- `backend/apps/berths/views.py` — replace `IcalFeedView`/`SyncMySeaView` with token-based + `OTAConnectionViewSet`
- `backend/apps/berths/urls.py` — new routes
- `backend/apps/berths/tests/test_allocator.py` — rewrite for new model
- `backend/apps/berths/tests/test_ical.py` — rewrite for new model
- `backend/apps/accounts/models.py` — remove 4 `mysea_*` fields
- `backend/apps/accounts/serializers.py` — remove channel fields
- `backend/apps/accounts/views.py` — remove `ChannelSettingsView`
- `backend/apps/accounts/urls.py` — remove `channel-settings/` URL
- `backend/apps/accounts/tests/test_channel_settings.py` — rewrite for OTA viewset
- `backend/apps/reservations/booking_engine.py` — update filter
- `backend/apps/reservations/receivers.py` — update allocator call
- `backend/apps/reservations/management/commands/sync_mysea_bookings.py` → renamed `sync_ota_bookings.py`
- `backend/apps/reservations/tests.py` — update ChannelFilterTest
- `frontend/src/App.jsx` — add Channels to SCREEN_MAP
- `frontend/src/components/layout/Sidebar.jsx` — add channels nav item
- `frontend/src/screens/Settings.jsx` — replace Channel Management card with OTA Connections card
- `field/src/screens/field/ChannelManagementFlow.jsx` — update for new API

**Retire (keep file, stop importing):**
- `backend/apps/accounts/views.py` — `ChannelSettingsView` deleted from file
- `backend/apps/reservations/management/commands/sync_mysea_bookings.py` — replaced by `sync_ota_bookings.py`

---

## Task 1: OTAConnection model + migration

**Files:**
- Modify: `backend/apps/berths/models.py`
- Create: `backend/apps/berths/tests/test_ota_connection.py`

- [ ] **Step 1: Add OTAConnection to models.py**

In `backend/apps/berths/models.py`, add before the `Pier` class:

```python
import uuid


class OTAConnection(models.Model):
    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='ota_connections')
    name             = models.CharField(max_length=100)
    slug             = models.SlugField(max_length=100)
    inbound_ical_url = models.URLField(blank=True, default='')
    outbound_token   = models.UUIDField(default=uuid.uuid4, unique=True)
    target_pct       = models.IntegerField(default=20)
    auto_allocate    = models.BooleanField(default=False)
    last_synced      = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ('marina', 'slug')
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.marina})'
```

- [ ] **Step 2: Generate migration**

```bash
cd backend
python manage.py makemigrations berths --name="ota_connection"
```

Expected: creates `backend/apps/berths/migrations/0021_ota_connection.py`

- [ ] **Step 3: Write tests**

Create `backend/apps/berths/tests/test_ota_connection.py`:

```python
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from apps.accounts.models import Marina, User
from apps.berths.models import OTAConnection


def make_setup():
    marina = Marina.objects.create(name='Test Marina')
    user = User.objects.create_user(email='mgr@test.com', password='pass', marina=marina, role='manager')
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return marina, user, client


class OTAConnectionCRUDTest(TestCase):
    def setUp(self):
        self.marina, self.user, self.client = make_setup()

    def test_create_connection(self):
        resp = self.client.post('/api/v1/ota-connections/', {
            'name': 'mySea', 'inbound_ical_url': 'https://example.com/cal.ics'
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['slug'], 'mysea')
        self.assertIn('outbound_token', resp.data)

    def test_list_connections_scoped_to_marina(self):
        OTAConnection.objects.create(marina=self.marina, name='A', slug='a')
        other = Marina.objects.create(name='Other Marina')
        OTAConnection.objects.create(marina=other, name='B', slug='b')
        resp = self.client.get('/api/v1/ota-connections/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 1)

    def test_delete_connection(self):
        conn = OTAConnection.objects.create(marina=self.marina, name='A', slug='a')
        resp = self.client.delete(f'/api/v1/ota-connections/{conn.pk}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(OTAConnection.objects.filter(pk=conn.pk).exists())

    def test_patch_target_pct(self):
        conn = OTAConnection.objects.create(marina=self.marina, name='A', slug='a')
        resp = self.client.patch(f'/api/v1/ota-connections/{conn.pk}/', {'target_pct': 30}, format='json')
        self.assertEqual(resp.status_code, 200)
        conn.refresh_from_db()
        self.assertEqual(conn.target_pct, 30)

    def test_duplicate_slug_rejected(self):
        OTAConnection.objects.create(marina=self.marina, name='A', slug='a')
        resp = self.client.post('/api/v1/ota-connections/', {'name': 'A2'}, format='json')
        self.assertEqual(resp.status_code, 400)
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
cd backend
python manage.py test apps.berths.tests.test_ota_connection -v 2
```

Expected: errors about missing URL `/api/v1/ota-connections/` — viewset not wired yet

- [ ] **Step 5: Run migration**

```bash
python manage.py migrate
```

Expected: OK

- [ ] **Step 6: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add backend/apps/berths/models.py backend/apps/berths/migrations/0021_ota_connection.py backend/apps/berths/tests/test_ota_connection.py
git -C "$(git rev-parse --show-toplevel)" commit -m "feat: add OTAConnection model"
```

---

## Task 2: OTAConnection serializer + ViewSet + URLs

**Files:**
- Modify: `backend/apps/berths/serializers.py`
- Modify: `backend/apps/berths/views.py`
- Modify: `backend/apps/berths/urls.py`

- [ ] **Step 1: Add OTAConnectionSerializer**

In `backend/apps/berths/serializers.py`, add after the existing imports:

```python
from .models import OTAConnection

class OTAConnectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = OTAConnection
        fields = ['id', 'name', 'slug', 'inbound_ical_url', 'outbound_token',
                  'target_pct', 'auto_allocate', 'last_synced']
        read_only_fields = ['id', 'slug', 'outbound_token', 'last_synced']

    def validate_name(self, value):
        from django.utils.text import slugify
        marina = self.context['request'].user.marina
        slug = slugify(value)
        qs = OTAConnection.objects.filter(marina=marina, slug=slug)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('An OTA connection with this name already exists.')
        return value

    def create(self, validated_data):
        from django.utils.text import slugify
        validated_data['slug'] = slugify(validated_data['name'])
        validated_data['marina'] = self.context['request'].user.marina
        return super().create(validated_data)
```

- [ ] **Step 2: Add OTAConnectionViewSet to views.py**

In `backend/apps/berths/views.py`, add after existing imports:

```python
from rest_framework import viewsets
from rest_framework.decorators import action
```

Add at the bottom of the file:

```python
class OTAConnectionViewSet(viewsets.ModelViewSet):
    serializer_class = OTAConnectionSerializer

    def get_queryset(self):
        return OTAConnection.objects.filter(marina=self.request.user.marina)

    @action(detail=True, methods=['post'])
    def sync(self, request, pk=None):
        conn = self.get_object()
        if not conn.inbound_ical_url:
            return Response({'detail': 'No inbound iCal URL configured.'}, status=400)
        from apps.reservations.management.commands.sync_ota_bookings import sync_connection
        count = sync_connection(conn, dry=False, stdout=None)
        conn.refresh_from_db(fields=['last_synced'])
        return Response({'synced': count, 'last_synced': conn.last_synced})

    @action(detail=True, methods=['post'])
    def rebalance(self, request, pk=None):
        conn = self.get_object()
        from apps.berths.allocator import rebalance_down
        rebalance_down(conn)
        return Response({'detail': 'Rebalance complete.'})
```

Also add `OTAConnection` to the import from `.models` at the top of views.py.

- [ ] **Step 3: Wire URLs**

In `backend/apps/berths/urls.py`, add:

```python
from rest_framework.routers import DefaultRouter
from .views import (
    PierListCreateView, PierDetailView,
    BerthListCreateView, BerthDetailView,
    MapConfigView, BulkCreateBerthsView, BulkUpdateBerthPricingView,
    BroadcastSMSView, AmenityListCreateView, AmenityDetailView,
    IcalFeedView, SyncMySeaView,
    OTAConnectionViewSet,
)

router = DefaultRouter()
router.register(r'ota-connections', OTAConnectionViewSet, basename='ota-connection')

urlpatterns = [
    # ... existing paths unchanged ...
] + router.urls
```

- [ ] **Step 4: Run tests**

```bash
cd backend
python manage.py test apps.berths.tests.test_ota_connection -v 2
```

Expected: 5 PASSes (sync/rebalance actions not yet fully testable — those depend on later tasks)

- [ ] **Step 5: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add backend/apps/berths/serializers.py backend/apps/berths/views.py backend/apps/berths/urls.py
git -C "$(git rev-parse --show-toplevel)" commit -m "feat: add OTAConnection serializer, ViewSet and URLs"
```

---

## Task 3: Update Berth model — swap channel fields

**Files:**
- Modify: `backend/apps/berths/models.py`

Replace `sales_channel` CharField and `channel_cooldown_until` with `ota_connection` FK and `channel_locked` BooleanField.

- [ ] **Step 1: Update Berth model**

In `backend/apps/berths/models.py`, in the `Berth` class, replace:

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

With:

```python
    ota_connection = models.ForeignKey(
        OTAConnection, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='berths'
    )
    channel_locked = models.BooleanField(default=False)
```

- [ ] **Step 2: Generate migrations**

```bash
cd backend
python manage.py makemigrations berths --name="berth_ota_fields"
```

Expected: creates migration adding `ota_connection` FK and `channel_locked`, removing `sales_channel` and `channel_cooldown_until`.

If Django asks about defaults for data loss — answer `1` (continue) since we handle data migration separately.

- [ ] **Step 3: Write data migration**

```bash
python manage.py makemigrations berths --empty --name="migrate_channel_data"
```

Edit the generated file to add:

```python
def migrate_channel_data(apps, schema_editor):
    """
    For marinas with auto_allocate_inventory=True:
      - Create one OTAConnection with name/slug='mysea', copying mysea_ical_url + mysea_target_pct
      - Assign berths that had sales_channel='mysea' to that connection
    Berths on other marinas or with sales_channel='direct' get ota_connection=NULL (direct).
    This migration is a no-op if there are no mysea-configured marinas.
    """
    pass  # Data already lost — sales_channel was removed in previous migration.
    # NOTE: If you need to preserve mysea berth assignments, run this migration
    # BEFORE the berth_ota_fields migration by reordering dependencies.
```

**Important:** The data migration must run BEFORE the field removal migration. Change the `dependencies` in `berth_ota_fields` migration to depend on `migrate_channel_data`, and `migrate_channel_data` to depend on `ota_connection`.

Rewrite the data migration:

```python
from django.db import migrations


def migrate_channel_data(apps, schema_editor):
    Marina = apps.get_model('accounts', 'Marina')
    OTAConnection = apps.get_model('berths', 'OTAConnection')
    Berth = apps.get_model('berths', 'Berth')

    for marina in Marina.objects.filter(auto_allocate_inventory=True).exclude(mysea_ical_url=''):
        import uuid
        conn, _ = OTAConnection.objects.get_or_create(
            marina=marina, slug='mysea',
            defaults={
                'name': 'mySea',
                'inbound_ical_url': marina.mysea_ical_url,
                'outbound_token': uuid.uuid4(),
                'target_pct': marina.mysea_target_pct,
                'auto_allocate': False,
                'last_synced': marina.mysea_last_synced,
            }
        )
        Berth.objects.filter(marina=marina, sales_channel='mysea').update(ota_connection=conn)


class Migration(migrations.Migration):
    dependencies = [
        ('berths', '0021_ota_connection'),
    ]
    operations = [
        migrations.RunPython(migrate_channel_data, migrations.RunPython.noop),
    ]
```

Then update `berth_ota_fields` migration dependencies to include `migrate_channel_data`:

```python
dependencies = [
    ('berths', '0022_migrate_channel_data'),
]
```

- [ ] **Step 4: Run migrations**

```bash
python manage.py migrate
```

Expected: all OK

- [ ] **Step 5: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add backend/apps/berths/models.py backend/apps/berths/migrations/
git -C "$(git rev-parse --show-toplevel)" commit -m "feat: replace berth sales_channel/cooldown with ota_connection FK + channel_locked"
```

---

## Task 4: Update allocator for multi-connection

**Files:**
- Modify: `backend/apps/berths/allocator.py`
- Modify: `backend/apps/berths/tests/test_allocator.py`

- [ ] **Step 1: Rewrite test file**

Replace `backend/apps/berths/tests/test_allocator.py` entirely:

```python
import datetime
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.berths.models import Berth, Pier, OTAConnection
from apps.billing.models import ChargeableItem


def make_marina(**kwargs):
    return Marina.objects.create(name='Test Marina', **kwargs)


def make_berth(marina, code, ota_connection=None, locked=False):
    pier, _ = Pier.objects.get_or_create(marina=marina, code='A', defaults={'label': 'A'})
    tier, _ = ChargeableItem.objects.get_or_create(
        marina=marina, name='Night',
        defaults={'category': 'berth', 'pricing_model': 'per_night', 'unit_price': 50}
    )
    return Berth.objects.create(
        marina=marina, pier=pier, code=code, pricing_tier=tier,
        status='available', ota_connection=ota_connection, channel_locked=locked,
    )


def make_conn(marina, slug, target_pct=20, auto_allocate=False):
    return OTAConnection.objects.create(
        marina=marina, name=slug.title(), slug=slug,
        target_pct=target_pct, auto_allocate=auto_allocate,
    )


class RunSmartAllocatorTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.conn = make_conn(self.marina, 'mysea', target_pct=20)
        self.berths = [make_berth(self.marina, f'B{i}') for i in range(10)]

    def test_freed_berth_assigned_to_connection_when_under_target(self):
        from apps.berths.allocator import run_smart_allocator
        freed = self.berths[0]
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        self.assertEqual(freed.ota_connection, self.conn)

    def test_freed_berth_stays_direct_when_at_target(self):
        from apps.berths.allocator import run_smart_allocator
        # Set 2 berths to mysea (20% of 10 = target met)
        self.berths[1].ota_connection = self.conn
        self.berths[1].save(update_fields=['ota_connection'])
        self.berths[2].ota_connection = self.conn
        self.berths[2].save(update_fields=['ota_connection'])
        freed = self.berths[0]
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        self.assertIsNone(freed.ota_connection)

    def test_locked_berth_not_reassigned(self):
        from apps.berths.allocator import run_smart_allocator
        freed = make_berth(self.marina, 'LOCKED', ota_connection=self.conn, locked=True)
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        # locked — allocator should not touch it
        self.assertEqual(freed.ota_connection, self.conn)

    def test_noop_when_no_connections(self):
        from apps.berths.allocator import run_smart_allocator
        self.conn.delete()
        freed = self.berths[0]
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        self.assertIsNone(freed.ota_connection)

    def test_maintenance_berths_excluded_from_pool(self):
        from apps.berths.allocator import run_smart_allocator
        self.berths[8].status = 'maintenance'
        self.berths[8].save(update_fields=['status'])
        self.berths[9].status = 'maintenance'
        self.berths[9].save(update_fields=['status'])
        freed = self.berths[0]
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        self.assertEqual(freed.ota_connection, self.conn)


class RebalanceDownTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.conn = make_conn(self.marina, 'mysea', target_pct=10)
        self.direct = [make_berth(self.marina, f'D{i}') for i in range(5)]
        self.ota = [make_berth(self.marina, f'M{i}', ota_connection=self.conn) for i in range(5)]

    def test_rebalance_flips_excess_unoccupied_to_direct(self):
        from apps.berths.allocator import rebalance_down
        rebalance_down(self.conn)
        count = Berth.objects.filter(marina=self.marina, ota_connection=self.conn).count()
        self.assertEqual(count, 1)  # 10% of 10 = 1

    def test_rebalance_leaves_occupied_berths_alone(self):
        from apps.berths.allocator import rebalance_down
        from apps.reservations.models import Booking
        for berth in self.ota[:3]:
            Booking.objects.create(
                marina=self.marina, berth=berth,
                check_in=datetime.date(2030, 1, 1), check_out=datetime.date(2030, 1, 5),
                nights=4, status='checked_in',
            )
        rebalance_down(self.conn)
        count = Berth.objects.filter(marina=self.marina, ota_connection=self.conn).count()
        self.assertEqual(count, 3)

    def test_rebalance_leaves_locked_berths_alone(self):
        from apps.berths.allocator import rebalance_down
        self.ota[0].channel_locked = True
        self.ota[0].save(update_fields=['channel_locked'])
        rebalance_down(self.conn)
        self.ota[0].refresh_from_db()
        self.assertEqual(self.ota[0].ota_connection, self.conn)


class BerthChannelLockTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.conn = make_conn(self.marina, 'mysea')
        self.user = User.objects.create_user(
            email='mgr@test.com', password='pass', marina=self.marina, role='manager'
        )
        self.berth = make_berth(self.marina, 'C1')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_channel_change_sets_lock(self):
        resp = self.client.patch(
            f'/api/v1/berths/{self.berth.pk}/',
            {'ota_connection': self.conn.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.berth.refresh_from_db()
        self.assertEqual(self.berth.ota_connection, self.conn)
        self.assertTrue(self.berth.channel_locked)

    def test_explicit_unlock_clears_lock(self):
        self.berth.channel_locked = True
        self.berth.ota_connection = self.conn
        self.berth.save(update_fields=['channel_locked', 'ota_connection'])
        resp = self.client.patch(
            f'/api/v1/berths/{self.berth.pk}/',
            {'channel_locked': False},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.berth.refresh_from_db()
        self.assertFalse(self.berth.channel_locked)

    def test_non_channel_update_does_not_set_lock(self):
        resp = self.client.patch(
            f'/api/v1/berths/{self.berth.pk}/',
            {'status': 'maintenance'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.berth.refresh_from_db()
        self.assertFalse(self.berth.channel_locked)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
python manage.py test apps.berths.tests.test_allocator -v 2
```

Expected: multiple failures — allocator still uses old fields

- [ ] **Step 3: Rewrite allocator.py**

Replace `backend/apps/berths/allocator.py` entirely:

```python
from apps.reservations.booking_engine import ACTIVE_STATUSES


def run_smart_allocator(marina, freed_berth):
    """
    Called when a berth is freed. Loops over all OTA connections for the marina,
    finds the one furthest below its target, and assigns the freed berth to it.
    If all connections are at/above target, sets berth to direct (ota_connection=None).
    Locked berths are never touched.
    Uses .update() to avoid triggering post_save signals (prevents loops).
    """
    if freed_berth.channel_locked:
        return

    from apps.berths.models import Berth, OTAConnection

    connections = list(OTAConnection.objects.filter(marina=marina))
    if not connections:
        return

    total_pool = (
        Berth.objects.filter(marina=marina)
        .exclude(status='maintenance')
        .count()
    )
    if total_pool == 0:
        return

    # Find connection with largest shortfall (current% - target%)
    best_conn = None
    best_shortfall = 0

    for conn in connections:
        current = (
            Berth.objects.filter(marina=marina, ota_connection=conn)
            .exclude(status='maintenance')
            .exclude(pk=freed_berth.pk)
            .count()
        )
        target = round(total_pool * _effective_target(conn, connections, total_pool) / 100)
        shortfall = target - current
        if shortfall > best_shortfall:
            best_shortfall = shortfall
            best_conn = conn

    Berth.objects.filter(pk=freed_berth.pk).update(
        ota_connection=best_conn  # None = direct if no shortfall
    )


def rebalance_down(connection):
    """
    Called when a connection's target_pct is lowered or the connection is deleted.
    Flips unlocked, unoccupied berths back to direct until the count meets the new target.
    """
    from apps.berths.models import Berth, OTAConnection
    from apps.reservations.models import Booking

    marina = connection.marina
    connections = list(OTAConnection.objects.filter(marina=marina))

    total_pool = (
        Berth.objects.filter(marina=marina)
        .exclude(status='maintenance')
        .count()
    )
    if total_pool == 0:
        return

    target = round(total_pool * _effective_target(connection, connections, total_pool) / 100)

    occupied_ids = (
        Booking.objects.filter(marina=marina, status__in=ACTIVE_STATUSES)
        .exclude(berth__isnull=True)
        .values_list('berth_id', flat=True)
        .distinct()
    )

    candidates = (
        Berth.objects.filter(marina=marina, ota_connection=connection)
        .exclude(status='maintenance')
        .exclude(pk__in=occupied_ids)
        .exclude(channel_locked=True)
        .order_by('code')
    )

    current = (
        Berth.objects.filter(marina=marina, ota_connection=connection)
        .exclude(status='maintenance')
        .count()
    )

    to_flip = max(0, current - target)
    ids_to_flip = list(candidates.values_list('pk', flat=True)[:to_flip])
    if ids_to_flip:
        Berth.objects.filter(pk__in=ids_to_flip).update(ota_connection=None)


def _effective_target(connection, all_connections, total_pool):
    """
    Returns the effective target_pct for a connection.
    If auto_allocate=True, divides remaining % evenly among all auto connections.
    """
    if not connection.auto_allocate:
        return connection.target_pct

    manual_total = sum(c.target_pct for c in all_connections if not c.auto_allocate)
    remaining = max(0, 100 - manual_total)
    auto_count = sum(1 for c in all_connections if c.auto_allocate)
    if auto_count == 0:
        return 0
    return round(remaining / auto_count)
```

- [ ] **Step 4: Run tests**

```bash
cd backend
python manage.py test apps.berths.tests.test_allocator -v 2
```

Expected: all pass (BerthChannelLockTest may fail until serializer is updated in Task 5)

- [ ] **Step 5: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add backend/apps/berths/allocator.py backend/apps/berths/tests/test_allocator.py
git -C "$(git rev-parse --show-toplevel)" commit -m "feat: rewrite allocator for multi-connection OTA support"
```

---

## Task 5: Update booking engine, serializers, signals, and BerthDetailView

**Files:**
- Modify: `backend/apps/reservations/booking_engine.py`
- Modify: `backend/apps/reservations/tests.py`
- Modify: `backend/apps/berths/serializers.py`
- Modify: `backend/apps/berths/views.py`
- Modify: `backend/apps/berths/signals.py`
- Modify: `backend/apps/reservations/receivers.py`

- [ ] **Step 1: Update booking engine filter**

In `backend/apps/reservations/booking_engine.py`, find `compatible_available_berths` and replace:

```python
    qs = qs.filter(sales_channel='direct')
    qs = qs.exclude(channel_cooldown_until__gt=timezone.now())
```

With:

```python
    qs = qs.filter(ota_connection__isnull=True)
```

- [ ] **Step 2: Update ChannelFilterTest**

In `backend/apps/reservations/tests.py`, find `ChannelFilterTest` and replace it entirely:

```python
class ChannelFilterTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        from apps.berths.models import OTAConnection
        self.conn = OTAConnection.objects.create(
            marina=self.marina, name='mySea', slug='mysea', target_pct=20
        )
        self.berth = make_berth(self.marina)
        self.check_in = datetime.date(2030, 7, 1)
        self.check_out = datetime.date(2030, 7, 5)

    def test_ota_berth_excluded_from_direct_search(self):
        from apps.reservations.booking_engine import compatible_available_berths
        self.berth.ota_connection = self.conn
        self.berth.save(update_fields=['ota_connection'])
        qs = compatible_available_berths(self.marina, self.check_in, self.check_out)
        self.assertNotIn(self.berth, qs)

    def test_direct_berth_included_in_search(self):
        from apps.reservations.booking_engine import compatible_available_berths
        qs = compatible_available_berths(self.marina, self.check_in, self.check_out)
        self.assertIn(self.berth, qs)

    def test_null_ota_berth_included(self):
        from apps.reservations.booking_engine import compatible_available_berths
        self.berth.ota_connection = None
        self.berth.save(update_fields=['ota_connection'])
        qs = compatible_available_berths(self.marina, self.check_in, self.check_out)
        self.assertIn(self.berth, qs)
```

- [ ] **Step 3: Update BerthSerializer**

In `backend/apps/berths/serializers.py`, update `BerthSerializer.Meta`:

Replace `'sales_channel', 'channel_cooldown_until',` with `'ota_connection', 'channel_locked',` in `fields`.

Replace `'channel_cooldown_until'` in `read_only_fields` with nothing (both new fields are writable).

Full updated fields list:

```python
        fields = [
            'id', 'code', 'berth_type', 'berth_class', 'operational_type',
            'pier', 'pier_code', 'side', 'position_index',
            'length_m', 'max_draft_m', 'max_beam_m', 'amenities',
            'pricing_tier', 'pricing_tier_name', 'pricing_tier_unit_price',
            'status', 'effective_status', 'vessel', 'vessel_name',
            'local_x', 'local_y', 'position_on_parent', 'is_placed',
            'ota_connection', 'channel_locked',
        ]
        read_only_fields = [
            'id', 'pier_code', 'vessel_name', 'is_placed', 'effective_status',
        ]
```

- [ ] **Step 4: Update BerthDetailView.perform_update**

In `backend/apps/berths/views.py`, replace `perform_update` in `BerthDetailView`:

```python
    def perform_update(self, serializer):
        instance = self.get_object()
        new_conn = serializer.validated_data.get('ota_connection', '__not_provided__')

        if new_conn != '__not_provided__' and new_conn != instance.ota_connection:
            # Manual channel change → lock the berth permanently
            serializer.save(channel_locked=True)
        else:
            serializer.save()
```

- [ ] **Step 5: Update signals.py**

In `backend/apps/berths/signals.py`, remove all references to `channel_cooldown_until` and `sales_channel`. The allocator skip guard now checks `update_fields` for `ota_connection`:

```python
@receiver(post_save, sender='berths.Berth')
def on_berth_save(sender, instance, created, **kwargs):
    _push_berth_update(instance)

    update_fields = kwargs.get('update_fields')
    if update_fields and 'ota_connection' in update_fields and len(update_fields) == 1:
        return  # allocator .update() — skip to avoid loops
    prev = getattr(instance, '_prev_status', None)
    if prev == 'maintenance' and instance.status != 'maintenance':
        marina = instance.marina
        from apps.berths.models import OTAConnection
        if OTAConnection.objects.filter(marina=marina).exists():
            from apps.berths.allocator import run_smart_allocator
            run_smart_allocator(marina, instance)
```

- [ ] **Step 6: Update receivers.py**

In `backend/apps/reservations/receivers.py`, the `on_booking_save` function references `marina.auto_allocate_inventory`. Replace that guard:

```python
@receiver(post_save, sender=Booking)
def on_booking_save(sender, instance, **kwargs):
    if instance.status not in ('checked_out', 'cancelled'):
        return
    if not instance.berth_id:
        return
    marina = instance.marina
    from apps.berths.models import OTAConnection
    if not OTAConnection.objects.filter(marina=marina).exists():
        return
    from apps.berths.allocator import run_smart_allocator
    instance.berth.refresh_from_db(fields=['ota_connection', 'status', 'channel_locked'])
    run_smart_allocator(marina, instance.berth)
```

- [ ] **Step 7: Run tests**

```bash
cd backend
python manage.py test apps.berths apps.reservations -v 1 2>&1 | grep -E "Ran|OK|FAILED|ERROR"
```

Expected: all pass (except the 7 pre-existing failures in test_accounts.py)

- [ ] **Step 8: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add backend/apps/reservations/booking_engine.py backend/apps/reservations/tests.py backend/apps/berths/serializers.py backend/apps/berths/views.py backend/apps/berths/signals.py backend/apps/reservations/receivers.py
git -C "$(git rev-parse --show-toplevel)" commit -m "feat: update booking engine, serializer, signals for ota_connection model"
```

---

## Task 6: Update iCal feed + sync command

**Files:**
- Modify: `backend/apps/berths/ical.py`
- Create: `backend/apps/reservations/management/commands/sync_ota_bookings.py`
- Modify: `backend/apps/berths/views.py`
- Modify: `backend/apps/berths/urls.py`
- Modify: `backend/apps/berths/tests/test_ical.py`

- [ ] **Step 1: Rewrite ical.py**

Replace `backend/apps/berths/ical.py` entirely:

```python
from datetime import timedelta
from django.utils import timezone
from icalendar import Calendar, Event

from apps.reservations.booking_engine import ACTIVE_STATUSES


def generate_ota_ical(connection) -> bytes:
    """
    Generate an RFC 5545 iCalendar feed of all active bookings on berths
    assigned to the given OTAConnection. Used for outbound feed to the OTA partner.
    Returns bytes (UTF-8 encoded .ics content).
    """
    from apps.reservations.models import Booking

    now = timezone.now()
    cal = Calendar()
    cal.add('prodid', '-//DocksBase//OTA Channel Feed//EN')
    cal.add('version', '2.0')
    cal.add('calscale', 'GREGORIAN')
    cal.add('method', 'PUBLISH')

    bookings = (
        Booking.objects.filter(
            marina=connection.marina,
            berth__ota_connection=connection,
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
        summary = booking.guest_name or (f'LOA {booking.boat_loa}m' if booking.boat_loa else 'Reserved')
        event.add('summary', summary)
        cal.add_component(event)

    return cal.to_ical()
```

- [ ] **Step 2: Update IcalFeedView to use token**

In `backend/apps/berths/views.py`, replace `IcalFeedView`:

```python
class IcalFeedView(APIView):
    permission_classes = []  # public — outbound_token is the secret

    def get(self, request, token):
        from apps.berths.models import OTAConnection
        from .ical import generate_ota_ical
        try:
            conn = OTAConnection.objects.get(outbound_token=token)
        except OTAConnection.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=404)
        return HttpResponse(
            generate_ota_ical(conn),
            content_type='text/calendar; charset=utf-8',
            headers={'Content-Disposition': f'attachment; filename="{conn.slug}.ics"'},
        )
```

- [ ] **Step 3: Update URL for iCal feed**

In `backend/apps/berths/urls.py`, replace:

```python
path('berths/ical/mysea.ics', IcalFeedView.as_view(), name='berths_ical_mysea'),
```

With:

```python
path('berths/ical/<uuid:token>.ics', IcalFeedView.as_view(), name='berths_ical_ota'),
```

Also remove `SyncMySeaView` from imports and urlpatterns (replaced by ViewSet action).

- [ ] **Step 4: Create sync_ota_bookings management command**

Create `backend/apps/reservations/management/commands/sync_ota_bookings.py`:

```python
"""
sync_ota_bookings — run every 10 minutes via cron.

Fetches the inbound iCal feed for each OTAConnection that has inbound_ical_url set,
parses each VEVENT, and creates/updates Booking records with booking_source='ota'.

Usage:
  python manage.py sync_ota_bookings
  python manage.py sync_ota_bookings --marina-slug=port-de-nice
  python manage.py sync_ota_bookings --dry-run
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
    if hasattr(dt_value, 'dt'):
        val = dt_value.dt
    else:
        val = dt_value
    if hasattr(val, 'date'):
        return val.date()
    return val


def _parse_loa_from_summary(summary: str):
    match = re.search(r'LOA\s+([\d.]+)', summary or '', re.IGNORECASE)
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            pass
    return None


def _find_free_ota_berth(connection, check_in, check_out, boat_loa=None):
    from apps.berths.models import Berth
    from apps.reservations.models import Booking

    blocked_ids = (
        Booking.objects.filter(
            marina=connection.marina,
            berth__isnull=False,
            status__in=ACTIVE_STATUSES,
            check_in__lt=check_out,
            check_out__gt=check_in,
        )
        .values_list('berth_id', flat=True)
        .distinct()
    )

    qs = Berth.objects.filter(
        marina=connection.marina,
        ota_connection=connection,
    ).exclude(status='maintenance').exclude(pk__in=blocked_ids).order_by('code')

    if boat_loa is not None:
        qs = qs.filter(length_m__gte=boat_loa)

    return qs.first()


def sync_connection(connection, dry=False, stdout=None):
    from apps.reservations.models import Booking

    if not connection.inbound_ical_url:
        return 0

    try:
        resp = requests.get(connection.inbound_ical_url, timeout=15)
        resp.raise_for_status()
    except Exception as exc:
        if stdout:
            stdout.write(f'  ERROR fetching feed for {connection.slug}: {exc}')
        return 0

    try:
        cal = Calendar.from_ical(resp.content)
    except Exception as exc:
        if stdout:
            stdout.write(f'  ERROR parsing iCal for {connection.slug}: {exc}')
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
                marina=connection.marina,
                booking_source=connection.slug[:20],
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
                continue

            berth = _find_free_ota_berth(connection, check_in, check_out, boat_loa)
            if berth is None:
                if stdout:
                    stdout.write(f'  WARNING: No free berth for {check_in}–{check_out} (uid={uid})')
                continue

            nights = (check_out - check_in).days or 1
            if not dry:
                Booking.objects.create(
                    marina=connection.marina,
                    berth=berth,
                    check_in=check_in,
                    check_out=check_out,
                    nights=nights,
                    status='confirmed',
                    paid=True,
                    booking_source=connection.slug[:20],
                    mysea_event_uid=uid,  # TODO: rename to ota_event_uid in a follow-up migration
                    guest_name=summary[:200] if summary else '',
                    boat_loa=boat_loa,
                )
            created += 1

        if not dry:
            connection.last_synced = timezone.now()
            connection.save(update_fields=['last_synced'])

    return created + updated


class Command(BaseCommand):
    help = 'Sync OTA bookings from iCal feeds for all connections with inbound_ical_url set'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--marina-slug', default='')

    def handle(self, *args, **options):
        from apps.berths.models import OTAConnection

        dry = options['dry_run']
        slug = options['marina_slug']

        qs = OTAConnection.objects.exclude(inbound_ical_url='')
        if slug:
            qs = qs.filter(marina__slug=slug)

        total = 0
        for conn in qs:
            prefix = '[DRY] ' if dry else ''
            self.stdout.write(f'{prefix}Syncing {conn.marina.slug} / {conn.slug}…')
            count = sync_connection(conn, dry=dry, stdout=self.stdout)
            total += count
            self.stdout.write(f'  {count} events processed.')

        self.stdout.write(f'Done. Total: {total}')
```

- [ ] **Step 5: Rewrite test_ical.py**

Replace `backend/apps/berths/tests/test_ical.py` entirely:

```python
import datetime
from django.test import TestCase
from django.utils import timezone
from apps.accounts.models import Marina
from apps.berths.models import Berth, Pier, OTAConnection
from apps.billing.models import ChargeableItem
from apps.reservations.models import Booking


def make_marina():
    return Marina.objects.create(name='Test Marina')


def make_conn(marina):
    return OTAConnection.objects.create(marina=marina, name='mySea', slug='mysea')


def make_berth(marina, code, connection=None):
    pier, _ = Pier.objects.get_or_create(marina=marina, code='A', defaults={'label': 'A'})
    tier, _ = ChargeableItem.objects.get_or_create(
        marina=marina, name='Night',
        defaults={'category': 'berth', 'pricing_model': 'per_night', 'unit_price': 50}
    )
    return Berth.objects.create(
        marina=marina, pier=pier, code=code, pricing_tier=tier,
        status='available', ota_connection=connection,
    )


class OutboundIcalTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.conn = make_conn(self.marina)
        self.berth = make_berth(self.marina, 'A1', connection=self.conn)

    def test_active_booking_appears_as_vevent(self):
        from apps.berths.ical import generate_ota_ical
        Booking.objects.create(
            marina=self.marina, berth=self.berth,
            check_in=datetime.date(2030, 7, 1),
            check_out=datetime.date(2030, 7, 5),
            nights=4, status='confirmed', booking_source='mysea',
            guest_name='J. Smith',
        )
        cal_str = generate_ota_ical(self.conn)
        self.assertIn(b'VEVENT', cal_str)
        self.assertIn(b'20300701', cal_str)
        self.assertIn(b'DTSTAMP', cal_str)

    def test_direct_booking_excluded(self):
        from apps.berths.ical import generate_ota_ical
        direct_berth = make_berth(self.marina, 'B1', connection=None)
        Booking.objects.create(
            marina=self.marina, berth=direct_berth,
            check_in=datetime.date(2030, 7, 1),
            check_out=datetime.date(2030, 7, 5),
            nights=4, status='confirmed', booking_source='direct',
        )
        cal_str = generate_ota_ical(self.conn)
        self.assertNotIn(b'VEVENT', cal_str)

    def test_ical_endpoint_returns_200(self):
        response = self.client.get(f'/api/v1/berths/ical/{self.conn.outbound_token}.ics')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'text/calendar; charset=utf-8')
```

- [ ] **Step 6: Smoke-test command**

```bash
cd backend
python manage.py sync_ota_bookings --dry-run
```

Expected: `Done. Total: 0`

- [ ] **Step 7: Run iCal tests**

```bash
python manage.py test apps.berths.tests.test_ical -v 2
```

Expected: 3 PASSes

- [ ] **Step 8: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add backend/apps/berths/ical.py backend/apps/berths/views.py backend/apps/berths/urls.py backend/apps/berths/tests/test_ical.py backend/apps/reservations/management/commands/sync_ota_bookings.py
git -C "$(git rev-parse --show-toplevel)" commit -m "feat: token-based iCal feed and generic sync_ota_bookings command"
```

---

## Task 7: Remove old Marina channel fields + ChannelSettingsView

**Files:**
- Modify: `backend/apps/accounts/models.py`
- Modify: `backend/apps/accounts/serializers.py`
- Modify: `backend/apps/accounts/views.py`
- Modify: `backend/apps/accounts/urls.py`
- Modify: `backend/apps/accounts/tests/test_channel_settings.py`

- [ ] **Step 1: Remove Marina channel fields**

In `backend/apps/accounts/models.py`, remove these 4 lines:

```python
    # mySea channel management
    auto_allocate_inventory = models.BooleanField(default=False)
    mysea_target_pct = models.IntegerField(default=20, validators=[MinValueValidator(0), MaxValueValidator(100)])
    mysea_ical_url = models.URLField(blank=True, default='')
    mysea_last_synced = models.DateTimeField(null=True, blank=True)
```

Also remove the `MinValueValidator, MaxValueValidator` imports if no longer used elsewhere in the file (check first).

- [ ] **Step 2: Remove channel fields from MarinaSerializer**

In `backend/apps/accounts/serializers.py`, remove from `fields`:

```python
            # channel management
            'auto_allocate_inventory', 'mysea_target_pct', 'mysea_ical_url', 'mysea_last_synced',
```

Also remove `'mysea_last_synced'` from `read_only_fields`.

- [ ] **Step 3: Remove ChannelSettingsView**

In `backend/apps/accounts/views.py`, delete the entire `ChannelSettingsView` class.

- [ ] **Step 4: Remove channel-settings URL**

In `backend/apps/accounts/urls.py`, remove:
- The `ChannelSettingsView` import
- The `path('marina/channel-settings/', ...)` line

- [ ] **Step 5: Generate migration**

```bash
cd backend
python manage.py makemigrations accounts --name="remove_marina_channel_fields"
python manage.py migrate
```

Expected: OK

- [ ] **Step 6: Rewrite test_channel_settings.py to test OTA viewset instead**

Replace `backend/apps/accounts/tests/test_channel_settings.py`:

```python
"""
Channel settings are now managed via the OTAConnection viewset.
This file tests that the old /auth/marina/channel-settings/ endpoint is gone
and that the new OTA viewset correctly handles target_pct updates + rebalance.
"""
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.berths.models import Berth, Pier, OTAConnection
from apps.billing.models import ChargeableItem


def make_setup(target_pct=50):
    marina = Marina.objects.create(name='Test Marina')
    user = User.objects.create_user(email='mgr@test.com', password='pass', marina=marina, role='manager')
    pier = Pier.objects.create(marina=marina, code='A', label='A')
    tier = ChargeableItem.objects.create(
        marina=marina, name='Night', category='berth', pricing_model='per_night', unit_price=50
    )
    conn = OTAConnection.objects.create(marina=marina, name='mySea', slug='mysea', target_pct=target_pct)
    ota_berths = [
        Berth.objects.create(marina=marina, pier=pier, code=f'M{i}', pricing_tier=tier,
                              status='available', ota_connection=conn)
        for i in range(4)
    ]
    direct_berths = [
        Berth.objects.create(marina=marina, pier=pier, code=f'D{i}', pricing_tier=tier,
                              status='available', ota_connection=None)
        for i in range(4)
    ]
    return marina, user, conn, ota_berths + direct_berths


class OTAViewsetRebalanceTest(TestCase):
    def setUp(self):
        self.marina, self.user, self.conn, self.berths = make_setup(target_pct=50)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_old_channel_settings_endpoint_gone(self):
        resp = self.client.patch('/api/v1/auth/marina/channel-settings/', {}, format='json')
        self.assertEqual(resp.status_code, 404)

    def test_patch_target_pct_via_viewset(self):
        resp = self.client.patch(f'/api/v1/ota-connections/{self.conn.pk}/', {'target_pct': 25}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.conn.refresh_from_db()
        self.assertEqual(self.conn.target_pct, 25)

    def test_rebalance_action_flips_excess_berths(self):
        # marina has 4 OTA out of 8 = 50%. Lower to 0% then rebalance
        self.conn.target_pct = 0
        self.conn.save(update_fields=['target_pct'])
        resp = self.client.post(f'/api/v1/ota-connections/{self.conn.pk}/rebalance/')
        self.assertEqual(resp.status_code, 200)
        ota_count = Berth.objects.filter(marina=self.marina, ota_connection=self.conn).count()
        self.assertEqual(ota_count, 0)
```

- [ ] **Step 7: Run tests**

```bash
cd backend
python manage.py test apps.accounts -v 1 2>&1 | grep -E "Ran|OK|FAILED"
```

Expected: pass (the 7 pre-existing failures are still in test_accounts.py and not related to this)

- [ ] **Step 8: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add backend/apps/accounts/models.py backend/apps/accounts/serializers.py backend/apps/accounts/views.py backend/apps/accounts/urls.py backend/apps/accounts/tests/test_channel_settings.py backend/apps/accounts/migrations/
git -C "$(git rev-parse --show-toplevel)" commit -m "feat: remove marina channel fields and ChannelSettingsView"
```

---

## Task 8: Channels frontend screen

**Files:**
- Create: `frontend/src/screens/Channels.jsx`
- Create: `frontend/src/hooks/useOTAConnections.js`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/layout/Sidebar.jsx`

- [ ] **Step 1: Create useOTAConnections hook**

Create `frontend/src/hooks/useOTAConnections.js`:

```js
import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useOTAConnections() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    api.get('/ota-connections/')
      .then(r => setConnections(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { connections, setConnections, loading, reload };
}
```

- [ ] **Step 2: Create Channels.jsx**

Create `frontend/src/screens/Channels.jsx`:

```jsx
import { useState, useEffect } from 'react';
import api from '../api.js';
import useMarina from '../hooks/useMarina.js';
import useOTAConnections from '../hooks/useOTAConnections.js';

function Toggle({ on, onChange }) {
  return (
    <div onClick={() => onChange(!on)} style={{
      width: 32, height: 18, borderRadius: 9, cursor: 'pointer',
      background: on ? 'var(--teal)' : 'rgba(0,0,0,0.15)',
      position: 'relative', transition: 'background 0.15s', flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', top: 2, left: on ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%', background: '#fff',
        transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </div>
  );
}

// ── Section 1: Booking Pipeline ────────────────────────────────────────────

function BookingPipelineCard({ marina, updateMarina }) {
  const isAuto = marina?.booking_mode === 'auto_tetris';
  const [saving, setSaving] = useState(false);

  async function toggle() {
    setSaving(true);
    try {
      await updateMarina({ booking_mode: isAuto ? 'manual_approval' : 'auto_tetris' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-header-title">Booking Pipeline</div>
        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>How incoming booking requests are handled</div>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {['manual_approval', 'auto_tetris'].map(mode => {
          const active = marina?.booking_mode === mode;
          const label = mode === 'manual_approval' ? 'Manual approval' : 'Auto-confirm';
          const desc = mode === 'manual_approval'
            ? 'Bookings go to pending — you confirm each one'
            : 'Bookings are confirmed immediately on submission';
          return (
            <div
              key={mode}
              onClick={() => !saving && updateMarina({ booking_mode: mode })}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                background: active ? 'rgba(26,45,74,0.06)' : 'var(--bg)',
                border: active ? '1.5px solid rgba(26,45,74,0.18)' : '1.5px solid transparent',
                transition: 'all 0.12s',
              }}
            >
              <div style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                border: `2px solid ${active ? 'var(--navy)' : 'rgba(0,0,0,0.25)'}`,
                background: active ? 'var(--navy)' : 'transparent',
              }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: active ? 700 : 500 }}>{label}</div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>{desc}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Section 2: OTA Allocation ──────────────────────────────────────────────

function AllocationCard({ conn, berths, onUpdate }) {
  const total = berths.filter(b => b.status !== 'maintenance').length;
  const current = berths.filter(b => b.ota_connection === conn.id).length;
  const currentPct = total > 0 ? Math.round((current / total) * 100) : 0;
  const [rebalancing, setRebalancing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleTargetChange(val) {
    const pct = Math.min(100, Math.max(0, Number(val)));
    setSaving(true);
    try {
      const { data } = await api.patch(`/ota-connections/${conn.id}/`, { target_pct: pct });
      onUpdate(data);
    } finally {
      setSaving(false);
    }
  }

  async function handleAutoToggle(val) {
    const { data } = await api.patch(`/ota-connections/${conn.id}/`, { auto_allocate: val });
    onUpdate(data);
  }

  async function handleRebalance() {
    setRebalancing(true);
    try {
      await api.post(`/ota-connections/${conn.id}/rebalance/`);
    } finally {
      setRebalancing(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-header-title">{conn.name}</div>
        <span className="badge badge-navy">{currentPct}% current · {conn.auto_allocate ? 'auto' : `${conn.target_pct}% target`}</span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg)', borderRadius: 7 }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 500 }}>Auto-calculate target</div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>System divides remaining % evenly among auto connections</div>
          </div>
          <Toggle on={conn.auto_allocate} onChange={handleAutoToggle} />
        </div>
        {!conn.auto_allocate && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Target % · Direct: {100 - conn.target_pct}% · {conn.name}: {conn.target_pct}%
            </label>
            <input
              type="range" min={0} max={50} step={5}
              value={conn.target_pct}
              onChange={e => handleTargetChange(e.target.value)}
              style={{ width: '100%' }}
              disabled={saving}
            />
          </div>
        )}
        <div>
          <button className="btn btn-ghost btn-sm" disabled={rebalancing} onClick={handleRebalance}>
            {rebalancing ? 'Rebalancing…' : 'Rebalance now'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Section 3: Berth Assignment Grid ──────────────────────────────────────

function BerthGrid({ berths, setBerths, connections, piersFilter, setPiersFilter }) {
  const piers = [...new Set(berths.map(b => b.pier_code).filter(Boolean))].sort();
  const [saving, setSaving] = useState(null);

  const filtered = piersFilter ? berths.filter(b => b.pier_code === piersFilter) : berths;

  async function handleChannelChange(berth, connId) {
    setSaving(berth.id);
    try {
      const { data } = await api.patch(`/berths/${berth.id}/`, {
        ota_connection: connId || null,
      });
      setBerths(prev => prev.map(b => b.id === berth.id ? { ...b, ...data } : b));
    } finally {
      setSaving(null);
    }
  }

  async function handleUnlock(berth) {
    setSaving(berth.id);
    try {
      const { data } = await api.patch(`/berths/${berth.id}/`, { channel_locked: false });
      setBerths(prev => prev.map(b => b.id === berth.id ? { ...b, ...data } : b));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-header-title">Berth Assignment</div>
        <select
          value={piersFilter}
          onChange={e => setPiersFilter(e.target.value)}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 5, border: 'var(--border)' }}
        >
          <option value="">All piers</option>
          {piers.map(p => <option key={p} value={p}>Pier {p}</option>)}
        </select>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr><th>Berth</th><th>Pier</th><th>Channel</th><th>Locked</th></tr>
          </thead>
          <tbody>
            {filtered.map(b => (
              <tr key={b.id} style={{ background: b.channel_locked ? 'rgba(26,45,74,0.03)' : undefined }}>
                <td style={{ fontWeight: 600 }}>{b.code}</td>
                <td style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>{b.pier_code || '—'}</td>
                <td>
                  <select
                    value={b.ota_connection ?? ''}
                    disabled={saving === b.id}
                    onChange={e => handleChannelChange(b, e.target.value ? Number(e.target.value) : null)}
                    style={{ fontSize: 12, padding: '3px 6px', borderRadius: 5, border: 'var(--border)' }}
                  >
                    <option value="">Direct</option>
                    {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td>
                  {b.channel_locked ? (
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={() => handleUnlock(b)}
                      disabled={saving === b.id}
                      title="Unlock — let allocator manage this berth"
                    >
                      🔒 Unlock
                    </button>
                  ) : (
                    <span style={{ color: 'rgba(0,0,0,0.25)', fontSize: 12 }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────

export default function Channels() {
  const { marina, loading: marinaLoading, updateMarina } = useMarina();
  const { connections, setConnections, loading: connsLoading } = useOTAConnections();
  const [berths, setBerths] = useState([]);
  const [berthsLoading, setBerthsLoading] = useState(true);
  const [pierFilter, setPierFilter] = useState('');

  useEffect(() => {
    api.get('/berths/')
      .then(r => setBerths((r.data.results ?? r.data).filter(b => b.berth_class === 'standard')))
      .catch(() => {})
      .finally(() => setBerthsLoading(false));
  }, []);

  if (marinaLoading || connsLoading || berthsLoading) {
    return <div style={{ padding: 40, color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>Loading…</div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <BookingPipelineCard marina={marina} updateMarina={updateMarina} />
        {connections.length === 0 && (
          <div className="card">
            <div className="card-body" style={{ color: 'rgba(0,0,0,0.4)', fontSize: 13 }}>
              No OTA connections configured. Add one in <strong>Settings → System → OTA Connections</strong>.
            </div>
          </div>
        )}
        {connections.map(conn => (
          <AllocationCard
            key={conn.id}
            conn={conn}
            berths={berths}
            onUpdate={updated => setConnections(prev => prev.map(c => c.id === updated.id ? updated : c))}
          />
        ))}
      </div>
      <div>
        <BerthGrid
          berths={berths}
          setBerths={setBerths}
          connections={connections}
          piersFilter={pierFilter}
          setPiersFilter={setPierFilter}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add Channels to App.jsx**

In `frontend/src/App.jsx`, add import:

```jsx
import Channels from './screens/Channels.jsx';
```

Add to `SCREEN_MAP`:

```js
channels: Channels,
```

- [ ] **Step 4: Add channels to Sidebar NAV**

In `frontend/src/components/layout/Sidebar.jsx`, in the `'Management & Data'` group, add after `infrastructure`:

```js
{ id: 'channels', icon: 'share-2', label: 'Channels' },
```

Also add `'channels'` to the `canAccess` owner/manager-only guard by ensuring it falls through the default (it will — only `settings` is explicitly blocked for staff, and Channels should also be blocked for staff). Add to the `canAccess` function:

```js
if (moduleId === 'channels') return user.role === 'owner' || user.role === 'manager';
```

- [ ] **Step 5: Build frontend**

```bash
cd frontend
npm run build
```

Expected: builds successfully, no errors

- [ ] **Step 6: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add frontend/src/screens/Channels.jsx frontend/src/hooks/useOTAConnections.js frontend/src/App.jsx frontend/src/components/layout/Sidebar.jsx
git -C "$(git rev-parse --show-toplevel)" commit -m "feat: add Channels screen with pipeline toggle, allocation cards, berth grid"
```

---

## Task 9: Settings — OTA Connections card + remove old channel management

**Files:**
- Modify: `frontend/src/screens/Settings.jsx`

- [ ] **Step 1: Remove channel management state and handlers**

In `frontend/src/screens/Settings.jsx`, remove:
- `const [cs, setCs] = useState(...)` and all `cs`-related state (`csSaving`, `csSyncing`, `csLastSynced`)
- `saveChannelSettings()` function
- `triggerMySeaSync()` function
- The `setCs(...)` and `setCsLastSynced(...)` calls inside the `useEffect`
- The entire "Channel Management" card JSX from the System tab

- [ ] **Step 2: Add OTA Connections card**

In the System tab left column, after the Feature Flags card, add:

```jsx
{/* OTA Connections */}
<div className="card">
  <div className="card-header">
    <div className="card-header-title">OTA Connections</div>
    <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)' }}>Channel distribution partners</div>
  </div>
  <OTAConnectionsCard />
</div>
```

Add the `OTAConnectionsCard` component at the top of the file (before the `Settings` export):

```jsx
function OTAConnectionsCard() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null); // { name: '', inbound_ical_url: '' } | null
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/ota-connections/')
      .then(r => setConnections(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function addConnection() {
    if (!form?.name?.trim()) return;
    setSaving(true);
    try {
      const { data } = await api.post('/ota-connections/', form);
      setConnections(prev => [...prev, data]);
      setForm(null);
    } finally {
      setSaving(false);
    }
  }

  async function deleteConnection(id) {
    if (!window.confirm('Remove this OTA connection? Berths assigned to it will revert to Direct.')) return;
    await api.delete(`/ota-connections/${id}/`);
    setConnections(prev => prev.filter(c => c.id !== id));
  }

  async function triggerSync(conn) {
    await api.post(`/ota-connections/${conn.id}/sync/`);
    const { data } = await api.get(`/ota-connections/${conn.id}/`);
    setConnections(prev => prev.map(c => c.id === conn.id ? data : c));
  }

  if (loading) return <div style={{ padding: '12px 0', color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {connections.length === 0 && (
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', padding: '6px 0' }}>No OTA connections yet.</div>
      )}
      {connections.map(conn => (
        <div key={conn.id} style={{ padding: '10px 14px', background: 'var(--bg)', borderRadius: 7, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{conn.name}</div>
            <button className="btn btn-danger btn-sm" onClick={() => deleteConnection(conn.id)}>Remove</button>
          </div>
          {conn.inbound_ical_url && (
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
              Inbound: <span style={{ fontFamily: 'monospace' }}>{conn.inbound_ical_url.slice(0, 50)}…</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
              Outbound iCal:
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: 6, fontSize: 10 }}
                onClick={() => navigator.clipboard.writeText(`${window.location.origin}/api/v1/berths/ical/${conn.outbound_token}.ics`)}
              >
                Copy URL
              </button>
            </div>
            {conn.inbound_ical_url && (
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => triggerSync(conn)}>
                Sync now {conn.last_synced ? `· ${new Date(conn.last_synced).toLocaleTimeString()}` : ''}
              </button>
            )}
          </div>
        </div>
      ))}

      {form ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 14px', background: 'var(--bg)', borderRadius: 7 }}>
          <input
            placeholder="Connection name (e.g. mySea)"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            style={{ fontSize: 13 }}
          />
          <input
            placeholder="Inbound iCal URL (optional)"
            value={form.inbound_ical_url}
            onChange={e => setForm(f => ({ ...f, inbound_ical_url: e.target.value }))}
            style={{ fontSize: 13 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn btn-primary btn-sm" disabled={saving || !form.name.trim()} onClick={addConnection}>
              {saving ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setForm({ name: '', inbound_ical_url: '' })}>
          + Add connection
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build frontend**

```bash
cd frontend
npm run build
```

Expected: builds successfully

- [ ] **Step 4: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add frontend/src/screens/Settings.jsx
git -C "$(git rev-parse --show-toplevel)" commit -m "feat: replace channel management card with OTA Connections card in Settings"
```

---

## Task 10: Update field app

**Files:**
- Modify: `field/src/screens/field/ChannelManagementFlow.jsx`

- [ ] **Step 1: Update ChannelManagementFlow to use ota_connection + channel_locked**

Replace `field/src/screens/field/ChannelManagementFlow.jsx` entirely:

```jsx
import { useState, useEffect } from 'react';
import api from '../../api.js';

const HDR = { background: '#1a2d4a', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, color: '#fff' };
const BACK_BTN = { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#fff', padding: 0, minWidth: 44, minHeight: 44 };
const CARD = { background: '#fff', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' };

const DIRECT_BADGE = { background: '#e8f4ea', color: '#1a6b2e', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none' };
const OTA_BADGE   = { background: '#e8eef9', color: '#1a3c7e', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none' };
const LOCKED_BADGE = { background: '#f0e8f4', color: '#6b2e8a', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none' };

export default function ChannelManagementFlow({ onBack }) {
  const [berths, setBerths] = useState([]);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [confirm, setConfirm] = useState(null); // { berth, newConnId }
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get('/berths/'),
      api.get('/ota-connections/'),
    ])
      .then(([bRes, cRes]) => {
        setBerths((bRes.data.results ?? bRes.data).filter(b => b.berth_class === 'standard'));
        setConnections(cRes.data.results ?? cRes.data);
      })
      .catch(() => setError('Failed to load data.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleConfirm() {
    const { berth, newConnId } = confirm;
    setConfirm(null);
    setSaving(berth.id);
    try {
      const resp = await api.patch(`/berths/${berth.id}/`, { ota_connection: newConnId });
      setBerths(prev => prev.map(b => b.id === berth.id ? { ...b, ...resp.data } : b));
    } catch {
      setError('Failed to update berth channel.');
    } finally {
      setSaving(null);
    }
  }

  async function handleUnlock(berth) {
    setSaving(berth.id);
    try {
      const resp = await api.patch(`/berths/${berth.id}/`, { channel_locked: false });
      setBerths(prev => prev.map(b => b.id === berth.id ? { ...b, ...resp.data } : b));
    } finally {
      setSaving(null);
    }
  }

  function connName(connId) {
    if (!connId) return 'Direct';
    return connections.find(c => c.id === connId)?.name ?? 'OTA';
  }

  function nextConnId(berth) {
    // Cycle: direct → first conn → second conn → direct
    if (!berth.ota_connection) return connections[0]?.id ?? null;
    const idx = connections.findIndex(c => c.id === berth.ota_connection);
    return idx >= 0 && idx < connections.length - 1 ? connections[idx + 1].id : null;
  }

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
              Moving to <strong>{connName(confirm.newConnId)}</strong>. This berth will be locked to this channel until manually unlocked.
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
            const badge = b.channel_locked
              ? { style: LOCKED_BADGE, label: `🔒 ${connName(b.ota_connection)}` }
              : b.ota_connection
                ? { style: OTA_BADGE, label: connName(b.ota_connection) }
                : { style: DIRECT_BADGE, label: 'Direct' };
            return (
              <div key={b.id} style={CARD}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Berth {b.code}</div>
                  {b.pier_code && <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>Pier {b.pier_code}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {b.channel_locked && (
                    <button
                      style={{ fontSize: 11, padding: '2px 8px', background: 'none', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 5, cursor: 'pointer' }}
                      disabled={saving === b.id}
                      onClick={() => handleUnlock(b)}
                    >
                      Unlock
                    </button>
                  )}
                  <button
                    style={{ ...badge.style, opacity: saving === b.id ? 0.5 : 1 }}
                    disabled={saving === b.id || connections.length === 0}
                    onClick={() => !b.channel_locked && setConfirm({ berth: b, newConnId: nextConnId(b) })}
                  >
                    {saving === b.id ? '…' : badge.label}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build field app**

```bash
cd field
npm run build
```

Expected: builds successfully

- [ ] **Step 3: Run full backend test suite**

```bash
cd backend
python manage.py test apps.berths apps.reservations apps.accounts -v 1 2>&1 | grep -E "Ran|OK|FAILED"
```

Expected: same pass count as before this feature (7 pre-existing failures only)

- [ ] **Step 4: Commit**

```bash
git -C "$(git rev-parse --show-toplevel)" add field/src/screens/field/ChannelManagementFlow.jsx
git -C "$(git rev-parse --show-toplevel)" commit -m "feat: update field app channel management for generic OTA connections"
```

---

## Cron Update Note

Replace the old cron entry for `sync_mysea_bookings` with:

```
*/10 * * * * cd /path/to/backend && python manage.py sync_ota_bookings >> /var/log/ota_sync.log 2>&1
```

This is a deployment concern and not part of this implementation plan.

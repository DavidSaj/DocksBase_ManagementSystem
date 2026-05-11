# Topbar Search & Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a working global search (inline dropdown, fuzzy matching via Postgres trigram) and real-time WebSocket-pushed notifications (persisted in DB, three event types) to the management system topbar.

**Architecture:** A new `apps/search` Django app exposes `GET /api/v1/search/?q=` backed by `TrigramSimilarity` across all major models. A new `apps/notifications` app stores `Notification` rows and pushes them over WebSocket via Django Channels (`NotificationConsumer`) when signals fire on `BookingRequest`, overdue invoices, and `MaintenanceTask` assignment. The frontend adds `useSearch` and `useNotifications` hooks that feed a rewritten `Topbar`.

**Tech Stack:** Django 6, DRF, `django.contrib.postgres` (TrigramSimilarity), Django Channels, React 18, axios

---

## File Map

### New backend files
| File | Purpose |
|---|---|
| `apps/search/__init__.py` | Package marker |
| `apps/search/apps.py` | AppConfig |
| `apps/search/views.py` | `SearchView` — fans out trigram queries |
| `apps/search/urls.py` | `search/` route |
| `apps/search/migrations/__init__.py` | Package marker |
| `apps/search/migrations/0001_enable_trgm.py` | `CREATE EXTENSION IF NOT EXISTS pg_trgm` |
| `apps/search/tests.py` | SearchView tests |
| `apps/notifications/__init__.py` | Package marker |
| `apps/notifications/apps.py` | AppConfig — imports signals in `ready()` |
| `apps/notifications/models.py` | `Notification` model |
| `apps/notifications/serializers.py` | `NotificationSerializer` |
| `apps/notifications/utils.py` | `notify()` helper |
| `apps/notifications/consumers.py` | `NotificationConsumer` (AsyncWebsocketConsumer) |
| `apps/notifications/views.py` | List, mark-read, mark-all-read views |
| `apps/notifications/urls.py` | REST routes |
| `apps/notifications/signals.py` | Signal handlers for the three event types |
| `apps/notifications/migrations/__init__.py` | Package marker |
| `apps/notifications/migrations/0001_initial.py` | `Notification` table |
| `apps/notifications/tests.py` | notify() + consumer + signal tests |

### Modified backend files
| File | Change |
|---|---|
| `config/settings/base.py` | Add `apps.search`, `apps.notifications` to `LOCAL_APPS` |
| `config/urls.py` | Add search + notifications URL includes |
| `config/asgi.py` | Merge notifications WebSocket route into `URLRouter` |
| `apps/reservations/apps.py` | Import notification signal handler in `ready()` |
| `apps/maintenance/apps.py` | Import notification signal handler in `ready()` |
| `apps/billing/tasks.py` | Call `notify()` per manager/owner after email send |

### New frontend files
| File | Purpose |
|---|---|
| `src/hooks/useSearch.js` | Debounced search hook (API + nav items) |
| `src/hooks/useNotifications.js` | WebSocket + REST notifications hook |
| `src/components/layout/SearchDropdown.jsx` | Grouped results dropdown |

### Modified frontend files
| File | Change |
|---|---|
| `src/App.jsx` | Pass `setScreen` prop to `<Topbar>` |
| `src/components/layout/Topbar.jsx` | Wire up real search and notifications |

---

## Task 1: Enable pg_trgm extension

**Files:**
- Create: `backend/apps/search/__init__.py`
- Create: `backend/apps/search/apps.py`
- Create: `backend/apps/search/migrations/__init__.py`
- Create: `backend/apps/search/migrations/0001_enable_trgm.py`

- [ ] **Step 1: Create the search app skeleton**

```python
# backend/apps/search/__init__.py
# (empty)
```

```python
# backend/apps/search/apps.py
from django.apps import AppConfig

class SearchConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.search'
```

- [ ] **Step 2: Write the trgm migration**

```python
# backend/apps/search/migrations/__init__.py
# (empty)
```

```python
# backend/apps/search/migrations/0001_enable_trgm.py
from django.db import migrations

class Migration(migrations.Migration):
    dependencies = []

    operations = [
        migrations.RunSQL(
            sql='CREATE EXTENSION IF NOT EXISTS pg_trgm;',
            reverse_sql='DROP EXTENSION IF EXISTS pg_trgm;',
        ),
    ]
```

- [ ] **Step 3: Register the app in settings**

In `backend/config/settings/base.py`, add `'apps.search'` to `LOCAL_APPS` (after `'apps.fuel_dock'`):

```python
LOCAL_APPS = [
    # ... existing entries ...
    'apps.fuel_dock',
    'apps.search',       # ← add this line
    'apps.portal',
    # ...
]
```

- [ ] **Step 4: Run the migration**

```bash
cd backend
python manage.py migrate search
```

Expected output ends with: `Applying search.0001_enable_trgm... OK`

- [ ] **Step 5: Commit**

```bash
git add apps/search/ config/settings/base.py
git commit -m "feat(search): add search app and enable pg_trgm extension"
```

---

## Task 2: Search backend — view and URL

**Files:**
- Create: `backend/apps/search/views.py`
- Create: `backend/apps/search/urls.py`
- Create: `backend/apps/search/tests.py`
- Modify: `backend/config/urls.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/apps/search/tests.py
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.vessels.models import Vessel
from apps.members.models import Member


class SearchViewTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='mgr@test.com', password='pass', marina=self.marina, role='manager'
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.vessel = Vessel.objects.create(marina=self.marina, name='Lady Katherine', reg='UK123')
        self.member = Member.objects.create(marina=self.marina, name='John Smith', email='john@test.com')

    def test_requires_auth(self):
        c = APIClient()
        r = c.get('/api/v1/search/?q=lady')
        self.assertEqual(r.status_code, 401)

    def test_vessel_found(self):
        r = self.client.get('/api/v1/search/?q=lady')
        self.assertEqual(r.status_code, 200)
        labels = [item['label'] for item in r.json()]
        self.assertIn('Lady Katherine', labels)

    def test_member_found(self):
        r = self.client.get('/api/v1/search/?q=john')
        self.assertEqual(r.status_code, 200)
        labels = [item['label'] for item in r.json()]
        self.assertIn('John Smith', labels)

    def test_other_marina_not_returned(self):
        other = Marina.objects.create(name='Other Marina')
        Vessel.objects.create(marina=other, name='Secret Vessel', reg='XX999')
        r = self.client.get('/api/v1/search/?q=secret')
        self.assertEqual(r.status_code, 200)
        labels = [item['label'] for item in r.json()]
        self.assertNotIn('Secret Vessel', labels)

    def test_empty_query_returns_empty(self):
        r = self.client.get('/api/v1/search/?q=')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), [])

    def test_result_has_required_fields(self):
        r = self.client.get('/api/v1/search/?q=lady')
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(len(data) > 0)
        item = data[0]
        for field in ('type', 'id', 'label', 'sub', 'screen'):
            self.assertIn(field, item)
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend
python manage.py test apps.search.tests -v 2
```

Expected: several failures including `ImportError` or 404.

- [ ] **Step 3: Implement the search view**

```python
# backend/apps/search/views.py
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.contrib.postgres.search import TrigramSimilarity
from django.db.models import Value, CharField
from django.db.models.functions import Concat


THRESHOLD = 0.1
TOP_N = 3


def _top(qs, sim_field, label_fn, sub_fn, type_str, screen):
    results = []
    for obj in qs.filter(**{f'{sim_field}__gte': THRESHOLD}).order_by(f'-{sim_field}')[:TOP_N]:
        results.append({
            'type': type_str,
            'id': obj.pk,
            'label': label_fn(obj),
            'sub': sub_fn(obj),
            'screen': screen,
            'link_id': obj.pk,
        })
    return results


class SearchView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        q = request.query_params.get('q', '').strip()
        if not q:
            return Response([])

        marina = request.user.marina
        if not marina:
            return Response([])

        results = []

        # Vessels
        from apps.vessels.models import Vessel
        qs = Vessel.objects.filter(marina=marina).annotate(
            sim=TrigramSimilarity('name', q)
        )
        results += _top(qs, 'sim',
            lambda o: o.name,
            lambda o: f"{o.loa}m · {o.reg}" if o.loa else o.reg or '—',
            'vessel', 'vessels')

        # Members
        from apps.members.models import Member
        qs = Member.objects.filter(marina=marina).annotate(
            sim=TrigramSimilarity('name', q)
        )
        results += _top(qs, 'sim',
            lambda o: o.name,
            lambda o: o.email or '—',
            'member', 'members')

        # Bookings
        from apps.reservations.models import Booking
        qs = Booking.objects.filter(marina=marina).annotate(
            sim=TrigramSimilarity('guest_name', q)
        )
        results += _top(qs, 'sim',
            lambda o: o.vessel_name or o.guest_name or f'Booking #{o.pk}',
            lambda o: f"{o.check_in} – {o.check_out}",
            'booking', 'reservations')

        # Invoices
        from apps.billing.models import Invoice
        qs = Invoice.objects.filter(marina=marina).annotate(
            sim=TrigramSimilarity('invoice_number', q)
        )
        results += _top(qs, 'sim',
            lambda o: o.invoice_number,
            lambda o: f"€{o.total} · {o.status}",
            'invoice', 'billing')

        # Staff (Users with role staff/manager/owner)
        from apps.accounts.models import User
        qs = User.objects.filter(marina=marina).exclude(role='boater').annotate(
            full_name=Concat('first_name', Value(' '), 'last_name', output_field=CharField()),
            sim=TrigramSimilarity(
                Concat('first_name', Value(' '), 'last_name', output_field=CharField()), q
            )
        )
        results += _top(qs, 'sim',
            lambda o: f"{o.first_name} {o.last_name}".strip() or o.email,
            lambda o: o.role.capitalize(),
            'staff', 'staff')

        # Maintenance tasks
        from apps.maintenance.models import MaintenanceTask
        qs = MaintenanceTask.objects.filter(marina=marina).annotate(
            sim=TrigramSimilarity('title', q)
        )
        results += _top(qs, 'sim',
            lambda o: o.title,
            lambda o: f"{o.priority} · {o.status}",
            'maintenance_task', 'maintenance')

        # Sort all results by similarity descending, cap at 20
        results.sort(key=lambda x: x.get('_sim', 0), reverse=True)
        return Response(results[:20])
```

- [ ] **Step 4: Create the URL file**

```python
# backend/apps/search/urls.py
from django.urls import path
from .views import SearchView

urlpatterns = [
    path('search/', SearchView.as_view()),
]
```

- [ ] **Step 5: Wire into main URLs**

In `backend/config/urls.py`, add inside the `api/v1/` include list:

```python
path('', include('apps.search.urls')),
```

Add it after the `reports` line:
```python
path('', include('apps.reports.urls')),
path('', include('apps.search.urls')),   # ← add this line
```

- [ ] **Step 6: Run the tests**

```bash
cd backend
python manage.py test apps.search.tests -v 2
```

Expected: all 6 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/search/ config/urls.py
git commit -m "feat(search): implement SearchView with trigram similarity"
```

---

## Task 3: Notifications backend — model and migration

**Files:**
- Create: `backend/apps/notifications/__init__.py`
- Create: `backend/apps/notifications/apps.py`
- Create: `backend/apps/notifications/models.py`
- Create: `backend/apps/notifications/migrations/__init__.py`
- Create: `backend/apps/notifications/migrations/0001_initial.py`
- Modify: `backend/config/settings/base.py`

- [ ] **Step 1: Create the app skeleton**

```python
# backend/apps/notifications/__init__.py
# (empty)
```

```python
# backend/apps/notifications/migrations/__init__.py
# (empty)
```

```python
# backend/apps/notifications/apps.py
from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.notifications'

    def ready(self):
        from . import signals  # noqa: F401
```

- [ ] **Step 2: Write the Notification model**

```python
# backend/apps/notifications/models.py
from django.db import models
from django.conf import settings


class Notification(models.Model):
    KIND_CHOICES = [
        ('booking_request', 'Booking Request'),
        ('overdue_invoice', 'Overdue Invoice'),
        ('maintenance_assigned', 'Maintenance Assigned'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='notifications')
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='notifications')
    kind = models.CharField(max_length=30, choices=KIND_CHOICES)
    title = models.CharField(max_length=200)
    body = models.CharField(max_length=500)
    link_screen = models.CharField(max_length=50)
    link_id = models.IntegerField(null=True, blank=True)
    read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.kind} → {self.recipient_id}'
```

- [ ] **Step 3: Write the migration**

```python
# backend/apps/notifications/migrations/0001_initial.py
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('accounts', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Notification',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(choices=[('booking_request', 'Booking Request'), ('overdue_invoice', 'Overdue Invoice'), ('maintenance_assigned', 'Maintenance Assigned')], max_length=30)),
                ('title', models.CharField(max_length=200)),
                ('body', models.CharField(max_length=500)),
                ('link_screen', models.CharField(max_length=50)),
                ('link_id', models.IntegerField(blank=True, null=True)),
                ('read', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('marina', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='notifications', to='accounts.marina')),
                ('recipient', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='notifications', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
```

- [ ] **Step 4: Register in settings**

In `backend/config/settings/base.py`, add `'apps.notifications'` to `LOCAL_APPS` after `'apps.search'`:

```python
    'apps.search',
    'apps.notifications',   # ← add this line
    'apps.portal',
```

- [ ] **Step 5: Run migration**

```bash
cd backend
python manage.py migrate notifications
```

Expected: `Applying notifications.0001_initial... OK`

- [ ] **Step 6: Commit**

```bash
git add apps/notifications/ config/settings/base.py
git commit -m "feat(notifications): add Notification model and migration"
```

---

## Task 4: Notifications backend — notify() helper and serializer

**Files:**
- Create: `backend/apps/notifications/utils.py`
- Create: `backend/apps/notifications/serializers.py`
- Create: `backend/apps/notifications/tests.py`

- [ ] **Step 1: Write failing tests for notify()**

```python
# backend/apps/notifications/tests.py
from unittest.mock import patch, MagicMock
from django.test import TestCase
from apps.accounts.models import Marina, User
from apps.notifications.models import Notification
from apps.notifications.utils import notify


class NotifyHelperTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='mgr@test.com', password='pass', marina=self.marina, role='manager'
        )

    @patch('apps.notifications.utils.get_channel_layer')
    @patch('apps.notifications.utils.async_to_sync')
    def test_notify_creates_db_row(self, mock_a2s, mock_gcl):
        mock_a2s.return_value = lambda fn: lambda *a, **kw: None
        notify(
            marina=self.marina,
            recipient=self.user,
            kind='booking_request',
            title='New booking',
            body='Vessel Lady K, 3 nights',
            link_screen='reservations',
            link_id=42,
        )
        self.assertEqual(Notification.objects.filter(recipient=self.user).count(), 1)
        n = Notification.objects.get(recipient=self.user)
        self.assertEqual(n.kind, 'booking_request')
        self.assertEqual(n.link_id, 42)
        self.assertFalse(n.read)

    @patch('apps.notifications.utils.get_channel_layer')
    @patch('apps.notifications.utils.async_to_sync')
    def test_notify_calls_channel_layer(self, mock_a2s, mock_gcl):
        mock_layer = MagicMock()
        mock_gcl.return_value = mock_layer
        send_fn = MagicMock()
        mock_a2s.return_value = lambda fn: send_fn
        notify(
            marina=self.marina,
            recipient=self.user,
            kind='overdue_invoice',
            title='Invoice overdue',
            body='INV-0042 overdue',
            link_screen='billing',
        )
        send_fn.assert_called_once()
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend
python manage.py test apps.notifications.tests.NotifyHelperTests -v 2
```

Expected: `ImportError` on `notify`.

- [ ] **Step 3: Implement notify()**

```python
# backend/apps/notifications/utils.py
import logging
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from .models import Notification

logger = logging.getLogger(__name__)


def notify(*, marina, recipient, kind, title, body, link_screen, link_id=None):
    notif = Notification.objects.create(
        marina=marina,
        recipient=recipient,
        kind=kind,
        title=title,
        body=body,
        link_screen=link_screen,
        link_id=link_id,
    )
    _push_to_ws(notif)
    return notif


def _push_to_ws(notif):
    layer = get_channel_layer()
    if layer is None:
        return
    group = f'notif_user_{notif.recipient_id}'
    payload = {
        'type': 'notification.send',
        'id': notif.pk,
        'kind': notif.kind,
        'title': notif.title,
        'body': notif.body,
        'link_screen': notif.link_screen,
        'link_id': notif.link_id,
        'read': notif.read,
        'created_at': notif.created_at.isoformat(),
    }
    try:
        async_to_sync(layer.group_send)(group, payload)
    except Exception as exc:
        logger.warning('notifications: WebSocket push failed for user %s: %s', notif.recipient_id, exc)
```

- [ ] **Step 4: Write the serializer**

```python
# backend/apps/notifications/serializers.py
from rest_framework import serializers
from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ['id', 'kind', 'title', 'body', 'link_screen', 'link_id', 'read', 'created_at']
        read_only_fields = ['id', 'kind', 'title', 'body', 'link_screen', 'link_id', 'created_at']
```

- [ ] **Step 5: Run tests**

```bash
cd backend
python manage.py test apps.notifications.tests.NotifyHelperTests -v 2
```

Expected: both tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/notifications/utils.py apps/notifications/serializers.py apps/notifications/tests.py
git commit -m "feat(notifications): add notify() helper and serializer"
```

---

## Task 5: Notifications backend — WebSocket consumer

**Files:**
- Create: `backend/apps/notifications/consumers.py`
- Modify: `backend/config/asgi.py`

- [ ] **Step 1: Write the consumer**

```python
# backend/apps/notifications/consumers.py
import json
import logging
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from rest_framework_simplejwt.tokens import AccessToken
from django.contrib.auth import get_user_model

logger = logging.getLogger(__name__)
User = get_user_model()


class NotificationConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        token_str = self.scope['query_string'].decode()
        token_str = dict(
            part.split('=', 1) for part in token_str.split('&') if '=' in part
        ).get('token', '')

        user = await self._get_user(token_str)
        if user is None:
            await self.close(code=4001)
            return

        self.user = user
        self.group_name = f'notif_user_{user.pk}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        # Send last 20 unread notifications on connect
        notifs = await self._get_recent(user)
        await self.send(text_data=json.dumps({'type': 'initial', 'notifications': notifs}))

    async def disconnect(self, code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def notification_send(self, event):
        payload = {k: v for k, v in event.items() if k != 'type'}
        await self.send(text_data=json.dumps({'type': 'notification', **payload}))

    @database_sync_to_async
    def _get_user(self, token_str):
        try:
            data = AccessToken(token_str)
            return User.objects.get(pk=data['user_id'])
        except Exception:
            return None

    @database_sync_to_async
    def _get_recent(self, user):
        from .models import Notification
        from .serializers import NotificationSerializer
        qs = Notification.objects.filter(recipient=user).order_by('-created_at')[:20]
        return NotificationSerializer(qs, many=True).data
```

- [ ] **Step 2: Update asgi.py to include notifications WS route**

Replace the entire contents of `backend/config/asgi.py`:

```python
import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')

from django.core.asgi import get_asgi_application
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter
from django.urls import re_path
from apps.berths.routing import websocket_urlpatterns as berths_ws
from apps.notifications.consumers import NotificationConsumer

websocket_urlpatterns = berths_ws + [
    re_path(r'^ws/notifications/$', NotificationConsumer.as_asgi()),
]

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': URLRouter(websocket_urlpatterns),
})
```

- [ ] **Step 3: Verify the app starts without errors**

```bash
cd backend
python manage.py check
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 4: Commit**

```bash
git add apps/notifications/consumers.py config/asgi.py
git commit -m "feat(notifications): add WebSocket consumer and wire ASGI routing"
```

---

## Task 6: Notifications backend — REST endpoints

**Files:**
- Create: `backend/apps/notifications/views.py`
- Create: `backend/apps/notifications/urls.py`
- Modify: `backend/config/urls.py`

- [ ] **Step 1: Write failing tests**

In `backend/apps/notifications/tests.py`, add this class:

```python
from rest_framework.test import APIClient

class NotificationViewTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='View Test Marina')
        self.user = User.objects.create_user(
            email='view@test.com', password='pass', marina=self.marina, role='manager'
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.notif = Notification.objects.create(
            marina=self.marina, recipient=self.user,
            kind='booking_request', title='Test', body='Body',
            link_screen='reservations',
        )

    def test_list_returns_own_notifications(self):
        r = self.client.get('/api/v1/notifications/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()), 1)

    def test_mark_one_read(self):
        r = self.client.patch(f'/api/v1/notifications/{self.notif.pk}/read/')
        self.assertEqual(r.status_code, 200)
        self.notif.refresh_from_db()
        self.assertTrue(self.notif.read)

    def test_mark_all_read(self):
        Notification.objects.create(
            marina=self.marina, recipient=self.user,
            kind='overdue_invoice', title='T2', body='B2',
            link_screen='billing',
        )
        r = self.client.post('/api/v1/notifications/mark-all-read/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Notification.objects.filter(recipient=self.user, read=False).count(), 0)

    def test_cannot_see_other_users_notifications(self):
        other = User.objects.create_user(
            email='other@test.com', password='pass', marina=self.marina, role='staff'
        )
        Notification.objects.create(
            marina=self.marina, recipient=other,
            kind='booking_request', title='Other', body='OB',
            link_screen='reservations',
        )
        r = self.client.get('/api/v1/notifications/')
        self.assertEqual(len(r.json()), 1)  # only own
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend
python manage.py test apps.notifications.tests.NotificationViewTests -v 2
```

Expected: 404 errors (routes not yet wired).

- [ ] **Step 3: Write the views**

```python
# backend/apps/notifications/views.py
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from .models import Notification
from .serializers import NotificationSerializer


class NotificationListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = Notification.objects.filter(recipient=request.user).order_by('-created_at')[:50]
        return Response(NotificationSerializer(qs, many=True).data)


class MarkReadView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        try:
            notif = Notification.objects.get(pk=pk, recipient=request.user)
        except Notification.DoesNotExist:
            return Response(status=404)
        notif.read = True
        notif.save(update_fields=['read'])
        return Response(NotificationSerializer(notif).data)


class MarkAllReadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        updated = Notification.objects.filter(recipient=request.user, read=False).update(read=True)
        return Response({'updated': updated})
```

- [ ] **Step 4: Write the URL file**

```python
# backend/apps/notifications/urls.py
from django.urls import path
from .views import NotificationListView, MarkReadView, MarkAllReadView

urlpatterns = [
    path('notifications/', NotificationListView.as_view()),
    path('notifications/<int:pk>/read/', MarkReadView.as_view()),
    path('notifications/mark-all-read/', MarkAllReadView.as_view()),
]
```

- [ ] **Step 5: Wire into main URLs**

In `backend/config/urls.py`, add inside the `api/v1/` block after the search line:

```python
path('', include('apps.search.urls')),
path('', include('apps.notifications.urls')),   # ← add this line
```

- [ ] **Step 6: Run tests**

```bash
cd backend
python manage.py test apps.notifications.tests.NotificationViewTests -v 2
```

Expected: all 4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/notifications/views.py apps/notifications/urls.py config/urls.py
git commit -m "feat(notifications): add REST list/mark-read/mark-all-read endpoints"
```

---

## Task 7: Notifications backend — signal hooks

**Files:**
- Create: `backend/apps/notifications/signals.py`
- Modify: `backend/apps/reservations/apps.py`
- Modify: `backend/apps/maintenance/apps.py`
- Modify: `backend/apps/billing/tasks.py`

- [ ] **Step 1: Write failing signal tests**

In `backend/apps/notifications/tests.py`, add:

```python
from unittest.mock import patch

class SignalTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Signal Marina')
        self.manager = User.objects.create_user(
            email='sig_mgr@test.com', password='pass', marina=self.marina, role='manager'
        )
        self.owner = User.objects.create_user(
            email='sig_own@test.com', password='pass', marina=self.marina, role='owner'
        )

    @patch('apps.notifications.utils._push_to_ws')
    def test_booking_request_creates_notifications(self, mock_push):
        from apps.berths.models import Berth
        from apps.reservations.models import BookingRequest
        berth = Berth.objects.create(marina=self.marina, code='A1', pier=None)
        BookingRequest.objects.create(
            marina=self.marina, berth=berth,
            guest_name='Test Guest', start_date='2026-06-01', end_date='2026-06-04',
        )
        count = Notification.objects.filter(marina=self.marina, kind='booking_request').count()
        self.assertEqual(count, 2)  # manager + owner

    @patch('apps.notifications.utils._push_to_ws')
    def test_maintenance_task_assignment_creates_notification(self, mock_push):
        from apps.maintenance.models import MaintenanceTask
        MaintenanceTask.objects.create(
            marina=self.marina, title='Fix gate', assigned_to='Someone'
        )
        count = Notification.objects.filter(marina=self.marina, kind='maintenance_assigned').count()
        self.assertGreaterEqual(count, 1)
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend
python manage.py test apps.notifications.tests.SignalTests -v 2
```

Expected: both fail (no signals connected yet).

- [ ] **Step 3: Write the signals module**

```python
# backend/apps/notifications/signals.py
from django.db.models.signals import post_save
from django.dispatch import receiver


@receiver(post_save, sender='reservations.BookingRequest')
def on_booking_request_created(sender, instance, created, **kwargs):
    if not created:
        return
    from apps.accounts.models import User
    from .utils import notify
    recipients = User.objects.filter(
        marina=instance.marina,
        role__in=['owner', 'manager'],
        is_active=True,
    )
    for user in recipients:
        notify(
            marina=instance.marina,
            recipient=user,
            kind='booking_request',
            title='New booking request',
            body=f'{instance.guest_name or "Guest"} · {instance.start_date} – {instance.end_date}',
            link_screen='reservations',
            link_id=instance.pk,
        )


@receiver(post_save, sender='maintenance.MaintenanceTask')
def on_maintenance_task_assigned(sender, instance, created, **kwargs):
    if not instance.assigned_to:
        return
    # assigned_to is a CharField (name string), not a User FK.
    # Notify all managers/owners for the marina since we can't resolve to a specific User.
    from apps.accounts.models import User
    from .utils import notify
    # Only fire on first assignment (when task is created with assigned_to set,
    # or when assigned_to changes from blank to non-blank).
    # We detect this by checking if created=True with assigned_to, or
    # using update_fields hint. Fire conservatively on create only to avoid
    # duplicate notifications on every save.
    if not created:
        return
    recipients = User.objects.filter(
        marina=instance.marina,
        role__in=['owner', 'manager'],
        is_active=True,
    )
    for user in recipients:
        notify(
            marina=instance.marina,
            recipient=user,
            kind='maintenance_assigned',
            title='Maintenance task assigned',
            body=f'{instance.title} → {instance.assigned_to}',
            link_screen='maintenance',
            link_id=instance.pk,
        )
```

- [ ] **Step 4: Import signals in reservations app ready()**

In `backend/apps/reservations/apps.py`, add the import inside `ready()`:

```python
def ready(self):
    from apps.billing.signals import invoice_paid
    from .receivers import on_invoice_paid, on_booking_save  # noqa: F401
    invoice_paid.connect(on_invoice_paid, dispatch_uid='reservations.on_invoice_paid')
    import apps.notifications.signals  # noqa: F401  — registers booking_request signal
```

- [ ] **Step 5: Import signals in maintenance app ready()**

Replace the contents of `backend/apps/maintenance/apps.py`:

```python
from django.apps import AppConfig


class MaintenanceConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.maintenance'

    def ready(self):
        import apps.notifications.signals  # noqa: F401  — registers maintenance_task signal
```

- [ ] **Step 6: Add notify() calls in billing Celery task**

In `backend/apps/billing/tasks.py`, after the `send_mail` call succeeds (inside the `try` block, after `logger.info`), add:

```python
            # Notify each manager/owner in-app
            from apps.accounts.models import User as _User
            from apps.notifications.utils import notify as _notify
            mgr_users = _User.objects.filter(marina=marina, role__in=['owner', 'manager'], is_active=True)
            for inv in invoices:
                for mgr in mgr_users:
                    _notify(
                        marina=marina,
                        recipient=mgr,
                        kind='overdue_invoice',
                        title='Invoice overdue',
                        body=f'{inv.invoice_number} · €{inv.total} · {(today - inv.due_date).days}d overdue',
                        link_screen='billing',
                        link_id=inv.pk,
                    )
```

Place this after the `logger.info(...)` line and before the `except Exception` block.

- [ ] **Step 7: Run signal tests**

```bash
cd backend
python manage.py test apps.notifications.tests.SignalTests -v 2
```

Expected: both tests pass.

- [ ] **Step 8: Run full notifications test suite**

```bash
cd backend
python manage.py test apps.notifications -v 2
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/notifications/signals.py apps/reservations/apps.py apps/maintenance/apps.py apps/billing/tasks.py
git commit -m "feat(notifications): wire signal hooks for booking request, invoice, maintenance"
```

---

## Task 8: Frontend — pass setScreen to Topbar

**Files:**
- Modify: `backend/frontend/src/App.jsx`
- Modify: `backend/frontend/src/components/layout/Topbar.jsx`

- [ ] **Step 1: Pass setScreen prop in App.jsx**

In `frontend/src/App.jsx`, find the line:
```jsx
<Topbar screen={screen} />
```

Replace with:
```jsx
<Topbar screen={screen} setScreen={setScreen} />
```

- [ ] **Step 2: Accept setScreen in Topbar.jsx**

In `frontend/src/components/layout/Topbar.jsx`, update the function signature from:
```jsx
export default function Topbar({ screen }) {
```
to:
```jsx
export default function Topbar({ screen, setScreen }) {
```

- [ ] **Step 3: Verify app still loads without errors**

Start the dev server and confirm the topbar renders:
```bash
cd frontend
npm run dev
```

Open browser at `http://localhost:5173`, confirm no console errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx src/components/layout/Topbar.jsx
git commit -m "feat(topbar): pass setScreen prop to Topbar"
```

---

## Task 9: Frontend — useSearch hook and SearchDropdown

**Files:**
- Create: `frontend/src/hooks/useSearch.js`
- Create: `frontend/src/components/layout/SearchDropdown.jsx`

- [ ] **Step 1: Write useSearch hook**

```javascript
// frontend/src/hooks/useSearch.js
import { useState, useEffect, useRef } from 'react';
import api from '../api.js';

const NAV_ITEMS = [
  { label: 'Overview', screen: 'overview', keywords: ['overview', 'dashboard', 'home'] },
  { label: 'Harbour Map', screen: 'map', keywords: ['map', 'harbour', 'harbor', 'berths', 'chart'] },
  { label: 'Reservations', screen: 'reservations', keywords: ['reservations', 'bookings', 'booking'] },
  { label: 'Vessel Registry', screen: 'vessels', keywords: ['vessels', 'boats', 'registry', 'ship'] },
  { label: 'Boatyard', screen: 'boatyard', keywords: ['boatyard', 'haul', 'yard', 'repair'] },
  { label: 'Maintenance', screen: 'maintenance', keywords: ['maintenance', 'tasks', 'defects', 'incidents', 'assets'] },
  { label: 'Staff & Rota', screen: 'staff', keywords: ['staff', 'rota', 'roster', 'crew', 'shifts'] },
  { label: 'Billing', screen: 'billing', keywords: ['billing', 'invoices', 'payments', 'finance'] },
  { label: 'Reports', screen: 'reports', keywords: ['reports', 'analytics', 'statistics', 'charts'] },
  { label: 'Members', screen: 'members', keywords: ['members', 'owners', 'customers', 'clients'] },
  { label: 'Restaurant', screen: 'restaurant', keywords: ['restaurant', 'food', 'dining', 'menu'] },
  { label: 'Events', screen: 'events', keywords: ['events', 'venue', 'hire', 'calendar'] },
  { label: 'Settings', screen: 'settings', keywords: ['settings', 'configuration', 'config'] },
  { label: 'Documents', screen: 'documents', keywords: ['documents', 'esign', 'contracts', 'forms'] },
  { label: 'Boat Sales', screen: 'sales', keywords: ['sales', 'brokerage', 'listings', 'sell'] },
];

function matchNavItems(q) {
  const lower = q.toLowerCase();
  return NAV_ITEMS.filter(item =>
    item.label.toLowerCase().includes(lower) ||
    item.keywords.some(k => k.includes(lower))
  ).slice(0, 3).map(item => ({
    type: 'nav',
    id: item.screen,
    label: item.label,
    sub: 'Go to screen',
    screen: item.screen,
    link_id: null,
  }));
}

export default function useSearch(query) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const navMatches = matchNavItems(q);
        const { data } = await api.get(`/search/?q=${encodeURIComponent(q)}`);
        setResults([...navMatches, ...data]);
      } catch {
        setResults(matchNavItems(q));
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timerRef.current);
  }, [query]);

  return { results, loading };
}
```

- [ ] **Step 2: Write SearchDropdown component**

```jsx
// frontend/src/components/layout/SearchDropdown.jsx
import Ic from '../ui/Icon.jsx';

const TYPE_ICON = {
  nav: 'layout',
  vessel: 'anchor',
  member: 'user',
  booking: 'calendar',
  invoice: 'file-text',
  staff: 'users',
  maintenance_task: 'tool',
};

const TYPE_LABEL = {
  nav: 'Navigation',
  vessel: 'Vessels',
  member: 'Members',
  booking: 'Bookings',
  invoice: 'Invoices',
  staff: 'Staff',
  maintenance_task: 'Maintenance',
};

function groupResults(results) {
  const groups = {};
  for (const item of results) {
    if (!groups[item.type]) groups[item.type] = [];
    groups[item.type].push(item);
  }
  return groups;
}

export default function SearchDropdown({ results, loading, onSelect }) {
  if (loading) {
    return (
      <div style={dropdownStyle}>
        <div style={{ padding: '12px 16px', fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
          Searching…
        </div>
      </div>
    );
  }

  if (!results.length) {
    return (
      <div style={dropdownStyle}>
        <div style={{ padding: '12px 16px', fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
          No results
        </div>
      </div>
    );
  }

  const groups = groupResults(results);

  return (
    <div style={dropdownStyle}>
      {Object.entries(groups).map(([type, items]) => (
        <div key={type}>
          <div style={{ padding: '6px 16px 2px', fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {TYPE_LABEL[type] || type}
          </div>
          {items.map(item => (
            <div
              key={`${item.type}-${item.id}`}
              onClick={() => onSelect(item)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <Ic n={TYPE_ICON[type] || 'search'} s={13} style={{ opacity: 0.5, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.85)' }}>{item.label}</div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 1 }}>{item.sub}</div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const dropdownStyle = {
  position: 'absolute',
  top: '100%',
  right: 0,
  width: 320,
  background: '#fff',
  border: 'var(--border)',
  borderRadius: 10,
  boxShadow: 'var(--shadow2)',
  zIndex: 300,
  overflow: 'hidden',
  marginTop: 6,
  maxHeight: 400,
  overflowY: 'auto',
};
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSearch.js src/components/layout/SearchDropdown.jsx
git commit -m "feat(search): add useSearch hook and SearchDropdown component"
```

---

## Task 10: Frontend — useNotifications hook

**Files:**
- Create: `frontend/src/hooks/useNotifications.js`

- [ ] **Step 1: Write the hook**

```javascript
// frontend/src/hooks/useNotifications.js
import { useState, useEffect, useRef } from 'react';
import api from '../api.js';

export default function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const wsRef = useRef(null);

  useEffect(() => {
    // Fetch existing notifications from REST
    api.get('/notifications/').then(({ data }) => {
      setNotifications(data);
    }).catch(() => {});

    // Open WebSocket for real-time push
    const token = localStorage.getItem('access_token');
    if (!token) return;

    const base = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1')
      .replace(/^http/, 'ws')
      .replace('/api/v1', '');
    const ws = new WebSocket(`${base}/ws/notifications/?token=${token}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'initial') {
        setNotifications(msg.notifications);
      } else if (msg.type === 'notification') {
        setNotifications(prev => [msg, ...prev]);
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  async function markRead(id) {
    try {
      const { data } = await api.patch(`/notifications/${id}/read/`);
      setNotifications(prev => prev.map(n => n.id === id ? data : n));
    } catch {}
  }

  async function markAllRead() {
    try {
      await api.post('/notifications/mark-all-read/');
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {}
  }

  return { notifications, unreadCount, markRead, markAllRead };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useNotifications.js
git commit -m "feat(notifications): add useNotifications hook with WebSocket + REST"
```

---

## Task 11: Frontend — wire Topbar with real search and notifications

**Files:**
- Modify: `frontend/src/components/layout/Topbar.jsx`

- [ ] **Step 1: Rewrite Topbar.jsx**

Replace the entire file with:

```jsx
import { useState, useEffect, useRef } from 'react';
import Ic from '../ui/Icon.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import useSearch from '../../hooks/useSearch.js';
import useNotifications from '../../hooks/useNotifications.js';
import SearchDropdown from './SearchDropdown.jsx';

const TITLE_MAP = {
  overview:     'Overview',
  map:          'Harbour',
  reservations: 'Reservations',
  vessels:      'Vessel Registry',
  boatyard:     'Boatyard',
  maintenance:  'Maintenance',
  staff:        'Staff & Rota',
  billing:      'Billing',
  reports:      'Reports & Analytics',
  members:      'Members & Owners',
  restaurant:   'Restaurant',
  events:       'Events & Venue Hire',
  settings:     'Settings',
  documents:    'Documents & eSign',
  sales:        'Boat Sales & Brokerage',
};

function getInitials(user) {
  if (!user) return '?';
  const first = (user.first_name || '').trim();
  const last = (user.last_name || '').trim();
  if (first && last) return (first[0] + last[0]).toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  if (user.email) return user.email[0].toUpperCase();
  return '?';
}

export default function Topbar({ screen, setScreen }) {
  const { user, signOut } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const accountRef = useRef(null);
  const notifRef = useRef(null);
  const searchRef = useRef(null);
  const inputRef = useRef(null);

  const { results: searchResults, loading: searchLoading } = useSearch(searchQuery);
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

  const now = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dateStr = `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()} · ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  useEffect(() => {
    function handleMouseDown(e) {
      if (accountRef.current && !accountRef.current.contains(e.target)) setAccountOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
        setSearchQuery('');
      }
    }
    if (accountOpen || notifOpen || searchOpen) {
      document.addEventListener('mousedown', handleMouseDown);
    }
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [accountOpen, notifOpen, searchOpen]);

  function handleSearchIconClick() {
    setSearchOpen(true);
    setNotifOpen(false);
    setAccountOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function handleSearchKeyDown(e) {
    if (e.key === 'Escape') {
      setSearchOpen(false);
      setSearchQuery('');
    }
  }

  function handleSelectResult(item) {
    if (setScreen) setScreen(item.screen);
    setSearchOpen(false);
    setSearchQuery('');
  }

  function handleNotifClick(notif) {
    markRead(notif.id);
    if (setScreen && notif.link_screen) setScreen(notif.link_screen);
    setNotifOpen(false);
  }

  function handleSignOut() {
    signOut();
    window.location.href = '/login';
  }

  const initials = getInitials(user);
  const email = user?.email || '';
  const fullName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || email : 'Unknown';
  const showSearchDropdown = searchOpen && searchQuery.trim().length > 0;

  return (
    <div className="topbar">
      <div className="topbar-breadcrumb">
        <span>Harwich Marina</span>
        <span style={{ opacity: 0.4 }}> / </span>
        <b>{TITLE_MAP[screen] || screen}</b>
      </div>
      <div className="topbar-actions">
        <div className="topbar-date">{dateStr}</div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} />
          <span style={{ fontSize: 10, color: 'rgba(0,0,0,0.38)', fontWeight: 500 }}>All systems normal</span>
        </div>

        {/* Search */}
        <div style={{ position: 'relative' }} ref={searchRef}>
          {searchOpen ? (
            <input
              ref={inputRef}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search…"
              style={{
                height: 28, border: 'var(--border)', borderRadius: 6, padding: '0 10px',
                fontSize: 12, outline: 'none', width: 200, background: 'var(--bg)',
              }}
            />
          ) : (
            <div className="topbar-icon-btn" onClick={handleSearchIconClick}>
              <Ic n="search" s={14} />
            </div>
          )}
          {showSearchDropdown && (
            <SearchDropdown
              results={searchResults}
              loading={searchLoading}
              onSelect={handleSelectResult}
            />
          )}
        </div>

        {/* Notifications bell */}
        <div style={{ position: 'relative' }} ref={notifRef}>
          <div
            className="topbar-icon-btn"
            style={{ position: 'relative' }}
            onClick={() => { setNotifOpen(o => !o); setAccountOpen(false); setSearchOpen(false); setSearchQuery(''); }}
          >
            <Ic n="bell" s={14} />
            {unreadCount > 0 && <div className="notif-dot" />}
          </div>
          {notifOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, width: 320,
              background: '#fff', border: 'var(--border)', borderRadius: 10,
              boxShadow: 'var(--shadow2)', zIndex: 200, overflow: 'hidden', marginTop: 6,
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px', borderBottom: 'var(--border)',
              }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>Notifications</span>
                <button className="btn btn-ghost btn-sm" onClick={markAllRead}>Mark all read</button>
              </div>
              {notifications.length === 0 && (
                <div style={{ padding: '16px', fontSize: 12, color: 'rgba(0,0,0,0.4)', textAlign: 'center' }}>
                  No notifications
                </div>
              )}
              {notifications.slice(0, 10).map(n => (
                <div
                  key={n.id}
                  onClick={() => handleNotifClick(n)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '12px 16px', borderBottom: 'var(--border)', cursor: 'pointer',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: n.read ? 'rgba(0,0,0,0.2)' : '#dd5b00',
                    flexShrink: 0, marginTop: 4,
                  }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(0,0,0,0.85)' }}>{n.title}</div>
                    <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>{n.body}</div>
                  </div>
                </div>
              ))}
              <div
                onClick={() => { setNotifOpen(false); if (setScreen) setScreen('billing'); }}
                style={{ textAlign: 'center', fontSize: 11, padding: 10, cursor: 'pointer', color: 'var(--navy)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                View all notifications
              </div>
            </div>
          )}
        </div>

        {/* Account avatar */}
        <div style={{ position: 'relative' }} ref={accountRef}>
          <div
            className="avatar"
            style={{ background: 'var(--navy)', border: '1.5px solid rgba(0,0,0,0.1)', color: '#fff', cursor: 'pointer' }}
            onClick={() => { setAccountOpen(o => !o); setNotifOpen(false); }}
          >
            {initials}
          </div>
          {accountOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, minWidth: 200,
              background: '#fff', borderRadius: 8, boxShadow: 'var(--shadow2)',
              border: 'var(--border)', zIndex: 200, overflow: 'hidden', marginTop: 6,
            }}>
              <div style={{ padding: '10px 14px', borderBottom: 'var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,0.85)' }}>{fullName}</div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>{email}</div>
              </div>
              <div
                onClick={handleSignOut}
                style={{ padding: '10px 14px', fontSize: 12, cursor: 'pointer', color: 'rgba(0,0,0,0.75)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                Log out
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Start the dev server and test manually**

```bash
cd frontend
npm run dev
```

Verify:
1. Click the search icon — input expands with 200px width
2. Type "vessel" — dropdown appears with a "Navigation → Vessel Registry" nav item
3. Click the result — navigates to the vessels screen and dropdown closes
4. Press Escape — input collapses and query clears
5. Bell icon shows badge when unread count > 0 (you can test by creating a BookingRequest via API or Django admin)
6. Clicking a notification navigates to its linked screen and marks it read
7. "Mark all read" clears the badge

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/Topbar.jsx
git commit -m "feat(topbar): wire real search and notifications into Topbar"
```

---

## Task 12: Final integration check

- [ ] **Step 1: Run the full backend test suite**

```bash
cd backend
python manage.py test apps.search apps.notifications -v 2
```

Expected: all tests pass, 0 failures.

- [ ] **Step 2: Run Django system check**

```bash
cd backend
python manage.py check
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 3: Commit if anything was left unstaged**

```bash
git status
# if clean, nothing to do
```

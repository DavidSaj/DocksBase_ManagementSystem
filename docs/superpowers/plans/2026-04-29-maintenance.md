# Maintenance Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire all 4 existing Maintenance tabs to real APIs, add a Maintenance Tasks Kanban tab backed by a new `MaintenanceTask` model, and create a `/field` mobile route for field crew.

**Architecture:** DRF generics for all endpoints; atomic transaction for the Defect→MaintenanceTask workflow with `perform_update` auto-setting `completed_at`; `react-router-dom` added to expose `/field` as a standalone auth-gated mobile screen alongside the existing `/*` desktop app.

**Tech Stack:** Django 4.x, DRF, SimpleJWT, React 19, Vite, axios, react-router-dom

---

## File Structure

**Backend (create/modify):**
- Modify: `backend/apps/maintenance/models.py` — add `notes` to Incident, add `MaintenanceTask`
- Create: `backend/apps/maintenance/migrations/0003_incident_notes.py`
- Create: `backend/apps/maintenance/migrations/0004_maintenancetask.py`
- Create: `backend/apps/maintenance/serializers.py` — 5 serializers
- Replace: `backend/apps/maintenance/views.py` — 11 view classes replacing placeholder
- Replace: `backend/apps/maintenance/urls.py` — 11 URL patterns replacing placeholder
- Modify: `backend/apps/maintenance/admin.py` — register MaintenanceTask
- Create: `backend/apps/maintenance/tests.py` — full test suite

**Frontend (create/modify):**
- Create: `frontend/src/hooks/useTasks.js`
- Create: `frontend/src/hooks/useIncidents.js`
- Create: `frontend/src/hooks/useDefects.js`
- Create: `frontend/src/hooks/useMaintenanceTasks.js`
- Replace: `frontend/src/screens/Maintenance.jsx` — replace mock data with hooks, add Kanban tab
- Create: `frontend/src/screens/Field.jsx` — standalone mobile route
- Replace: `frontend/src/App.jsx` — extract DesktopApp, add Routes
- Replace: `frontend/src/main.jsx` — wrap in BrowserRouter
- Modify: `frontend/package.json` (via npm install react-router-dom)

---

### Task 1: Backend Models

**Files:**
- Modify: `backend/apps/maintenance/models.py`
- Create: `backend/apps/maintenance/tests.py` (initial model tests only)

- [ ] **Step 1: Create the failing model tests**

Create `backend/apps/maintenance/tests.py`:

```python
from django.test import TestCase
from apps.accounts.models import Marina
from apps.maintenance.models import Incident, MaintenanceTask


def make_marina():
    return Marina.objects.create(name='Test Marina')


class ModelTest(TestCase):
    def setUp(self):
        self.marina = make_marina()

    def test_incident_has_notes_field(self):
        inc = Incident.objects.create(
            marina=self.marina,
            description='Fire on dock',
            severity='high',
            occurred_at='2026-05-01T09:00:00Z',
        )
        inc.notes = 'Updated by harbour master'
        inc.save()
        self.assertEqual(Incident.objects.get(pk=inc.pk).notes, 'Updated by harbour master')

    def test_maintenance_task_creates(self):
        task = MaintenanceTask.objects.create(
            marina=self.marina,
            title='Fix gate lock',
            priority='high',
            status='pending',
        )
        self.assertEqual(str(task), 'Task: Fix gate lock')

    def test_maintenance_task_str(self):
        task = MaintenanceTask.objects.create(
            marina=self.marina,
            title='Repaint pontoon',
        )
        self.assertEqual(str(task), 'Task: Repaint pontoon')
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python manage.py test apps.maintenance.tests.ModelTest --settings=config.settings.dev -v 2
```

Expected: FAIL — `MaintenanceTask` does not exist; `Incident` has no `notes` field.

- [ ] **Step 3: Update models.py**

Replace `backend/apps/maintenance/models.py` with:

```python
from django.db import models


class Task(models.Model):
    PRIORITY = [('high', 'High'), ('medium', 'Medium'), ('low', 'Low')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='tasks')
    text = models.CharField(max_length=500)
    location = models.CharField(max_length=200, blank=True)
    priority = models.CharField(max_length=10, choices=PRIORITY, default='medium')
    assigned_to = models.CharField(max_length=200, blank=True)
    done = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.text[:60]


class Incident(models.Model):
    SEVERITY = [('low', 'Low'), ('medium', 'Medium'), ('high', 'High'), ('critical', 'Critical')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='incidents')
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True)
    berth = models.ForeignKey('berths.Berth', on_delete=models.SET_NULL, null=True, blank=True)
    description = models.TextField()
    severity = models.CharField(max_length=20, choices=SEVERITY, default='low')
    reporter = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)
    resolved = models.BooleanField(default=False)
    occurred_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'INC-{self.pk}'


class Asset(models.Model):
    STATUS = [
        ('ok', 'OK'), ('due_service', 'Due Service'),
        ('under_repair', 'Under Repair'), ('decommissioned', 'Decommissioned'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='assets')
    name = models.CharField(max_length=200)
    category = models.CharField(max_length=100, blank=True)
    location = models.CharField(max_length=200, blank=True)
    make = models.CharField(max_length=100, blank=True)
    model = models.CharField(max_length=100, blank=True)
    serial = models.CharField(max_length=100, blank=True)
    purchased = models.DateField(null=True, blank=True)
    cost = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS, default='ok')
    last_service = models.DateField(null=True, blank=True)
    next_service = models.DateField(null=True, blank=True)
    total_maint_cost = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    notes = models.TextField(blank=True)

    def __str__(self):
        return self.name


class Defect(models.Model):
    SEVERITY = [('low', 'Low'), ('medium', 'Medium'), ('high', 'High'), ('critical', 'Critical')]
    STATUS = [
        ('open', 'Open'), ('acknowledged', 'Acknowledged'),
        ('in_progress', 'In Progress'), ('resolved', 'Resolved'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='defects')
    asset = models.ForeignKey(Asset, on_delete=models.SET_NULL, null=True, blank=True)
    location = models.CharField(max_length=200, blank=True)
    description = models.TextField()
    severity = models.CharField(max_length=20, choices=SEVERITY, default='low')
    reporter = models.CharField(max_length=200, blank=True)
    assigned_to = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=20, choices=STATUS, default='open')
    reported_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'DEF-{self.pk}'


class MaintenanceTask(models.Model):
    PRIORITY = [('low', 'Low'), ('medium', 'Medium'), ('high', 'High'), ('urgent', 'Urgent')]
    STATUS = [
        ('pending', 'Pending'), ('in_progress', 'In Progress'),
        ('blocked', 'Blocked'), ('completed', 'Completed'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='maintenance_tasks')
    asset = models.ForeignKey(Asset, on_delete=models.SET_NULL, null=True, blank=True)
    defect = models.ForeignKey(Defect, on_delete=models.SET_NULL, null=True, blank=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    assigned_to = models.CharField(max_length=200, blank=True)
    priority = models.CharField(max_length=20, choices=PRIORITY, default='medium')
    status = models.CharField(max_length=20, choices=STATUS, default='pending')
    due_date = models.DateField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    completion_notes = models.TextField(blank=True)
    completion_photo = models.FileField(upload_to='maintenance_tasks/', null=True, blank=True)

    class Meta:
        ordering = ['-priority', 'due_date']

    def __str__(self):
        return f'Task: {self.title}'
```

- [ ] **Step 4: Run model tests — expect still fail (no migration yet)**

```bash
cd backend && python manage.py test apps.maintenance.tests.ModelTest --settings=config.settings.dev -v 2
```

Expected: FAIL with migration error. That is expected — migrations come in Task 2.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/maintenance/models.py backend/apps/maintenance/tests.py
git commit -m "feat(maintenance): add Incident.notes and MaintenanceTask model"
```

---

### Task 2: Migrations

**Files:**
- Create: `backend/apps/maintenance/migrations/0003_incident_notes.py`
- Create: `backend/apps/maintenance/migrations/0004_maintenancetask.py`

- [ ] **Step 1: Create migration 0003 — add notes to Incident**

Create `backend/apps/maintenance/migrations/0003_incident_notes.py`:

```python
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('maintenance', '0002_asset_notes'),
    ]

    operations = [
        migrations.AddField(
            model_name='incident',
            name='notes',
            field=models.TextField(blank=True, default=''),
            preserve_default=False,
        ),
    ]
```

- [ ] **Step 2: Create migration 0004 — MaintenanceTask**

Create `backend/apps/maintenance/migrations/0004_maintenancetask.py`:

```python
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0002_marina_operations_paused'),
        ('maintenance', '0003_incident_notes'),
    ]

    operations = [
        migrations.CreateModel(
            name='MaintenanceTask',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=200)),
                ('description', models.TextField(blank=True)),
                ('assigned_to', models.CharField(blank=True, max_length=200)),
                ('priority', models.CharField(
                    choices=[('low', 'Low'), ('medium', 'Medium'), ('high', 'High'), ('urgent', 'Urgent')],
                    default='medium', max_length=20,
                )),
                ('status', models.CharField(
                    choices=[('pending', 'Pending'), ('in_progress', 'In Progress'), ('blocked', 'Blocked'), ('completed', 'Completed')],
                    default='pending', max_length=20,
                )),
                ('due_date', models.DateField(blank=True, null=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('completion_notes', models.TextField(blank=True)),
                ('completion_photo', models.FileField(blank=True, null=True, upload_to='maintenance_tasks/')),
                ('marina', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='maintenance_tasks',
                    to='accounts.marina',
                )),
                ('asset', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    to='maintenance.asset',
                )),
                ('defect', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    to='maintenance.defect',
                )),
            ],
            options={
                'ordering': ['-priority', 'due_date'],
            },
        ),
    ]
```

- [ ] **Step 3: Apply migrations and verify model tests pass**

```bash
cd backend && python manage.py migrate --settings=config.settings.dev && python manage.py test apps.maintenance.tests.ModelTest --settings=config.settings.dev -v 2
```

Expected: All 3 model tests PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/apps/maintenance/migrations/0003_incident_notes.py backend/apps/maintenance/migrations/0004_maintenancetask.py
git commit -m "feat(maintenance): migrations for Incident.notes and MaintenanceTask"
```

---

### Task 3: Serializers, Views, URLs, Admin + Full Test Suite

**Files:**
- Create: `backend/apps/maintenance/serializers.py`
- Replace: `backend/apps/maintenance/views.py`
- Replace: `backend/apps/maintenance/urls.py`
- Modify: `backend/apps/maintenance/admin.py`
- Append to: `backend/apps/maintenance/tests.py`

- [ ] **Step 1: Append API tests to tests.py**

Append the following to the end of `backend/apps/maintenance/tests.py` (after the existing `ModelTest` class):

```python
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

User = get_user_model()


def make_user(marina, email='mgr@example.com'):
    return User.objects.create_user(email=email, password='pass', marina=marina)


class TaskViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina, 'task@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_create_task(self):
        r = self.client.post('/api/v1/tasks/', {'text': 'Check buoys', 'priority': 'high'})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data['text'], 'Check buoys')

    def test_list_scoped_to_marina(self):
        other = Marina.objects.create(name='Other Marina')
        oc = APIClient()
        oc.force_authenticate(make_user(other, 'other_task@example.com'))
        oc.post('/api/v1/tasks/', {'text': 'Other task', 'priority': 'low'})
        self.client.post('/api/v1/tasks/', {'text': 'My task', 'priority': 'medium'})
        r = self.client.get('/api/v1/tasks/')
        texts = [t['text'] for t in (r.data.get('results') or r.data)]
        self.assertIn('My task', texts)
        self.assertNotIn('Other task', texts)

    def test_patch_done(self):
        r = self.client.post('/api/v1/tasks/', {'text': 'Inspect dock', 'priority': 'low'})
        r2 = self.client.patch(f'/api/v1/tasks/{r.data["id"]}/', {'done': True})
        self.assertTrue(r2.data['done'])

    def test_delete_task(self):
        r = self.client.post('/api/v1/tasks/', {'text': 'Temp', 'priority': 'low'})
        r2 = self.client.delete(f'/api/v1/tasks/{r.data["id"]}/')
        self.assertEqual(r2.status_code, 204)


class IncidentViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina, 'inc@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _create(self, desc='Fuel spill', sev='high'):
        return self.client.post('/api/v1/incidents/', {
            'description': desc, 'severity': sev, 'occurred_at': '2026-05-01T09:00:00Z',
        })

    def test_create_incident(self):
        r = self._create()
        self.assertEqual(r.status_code, 201)

    def test_patch_resolved(self):
        pk = self._create().data['id']
        r = self.client.patch(f'/api/v1/incidents/{pk}/', {'resolved': True})
        self.assertTrue(r.data['resolved'])

    def test_patch_notes(self):
        pk = self._create('Gate failure', 'medium').data['id']
        r = self.client.patch(f'/api/v1/incidents/{pk}/', {'notes': 'Maintenance notified'})
        self.assertEqual(r.data['notes'], 'Maintenance notified')

    def test_get_scoped(self):
        other = Marina.objects.create(name='Other Marina 2')
        oc = APIClient()
        oc.force_authenticate(make_user(other, 'other_inc@example.com'))
        oc.post('/api/v1/incidents/', {'description': 'Other', 'severity': 'low', 'occurred_at': '2026-05-01T09:00:00Z'})
        self._create('Mine')
        r = self.client.get('/api/v1/incidents/')
        descs = [i['description'] for i in (r.data.get('results') or r.data)]
        self.assertIn('Mine', descs)
        self.assertNotIn('Other', descs)


class AssetViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina, 'asset@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_create_asset(self):
        r = self.client.post('/api/v1/assets/', {'name': 'Travelift 50T', 'category': 'Crane'})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data['name'], 'Travelift 50T')

    def test_patch_status(self):
        pk = self.client.post('/api/v1/assets/', {'name': 'Generator A'}).data['id']
        r = self.client.patch(f'/api/v1/assets/{pk}/', {'status': 'due_service'})
        self.assertEqual(r.data['status'], 'due_service')

    def test_get_scoped(self):
        other = Marina.objects.create(name='Other Marina 3')
        oc = APIClient()
        oc.force_authenticate(make_user(other, 'other_asset@example.com'))
        oc.post('/api/v1/assets/', {'name': 'Other Asset'})
        self.client.post('/api/v1/assets/', {'name': 'My Asset'})
        r = self.client.get('/api/v1/assets/')
        names = [a['name'] for a in (r.data.get('results') or r.data)]
        self.assertIn('My Asset', names)
        self.assertNotIn('Other Asset', names)


class DefectViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina, 'defect@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_create_defect(self):
        r = self.client.post('/api/v1/defects/', {'description': 'Broken latch', 'severity': 'medium'})
        self.assertEqual(r.status_code, 201)

    def test_patch_acknowledge(self):
        pk = self.client.post('/api/v1/defects/', {'description': 'Cracked cleat', 'severity': 'low'}).data['id']
        r = self.client.patch(f'/api/v1/defects/{pk}/', {'status': 'acknowledged'})
        self.assertEqual(r.data['status'], 'acknowledged')

    def test_patch_resolve(self):
        pk = self.client.post('/api/v1/defects/', {'description': 'Broken light', 'severity': 'low'}).data['id']
        self.client.patch(f'/api/v1/defects/{pk}/', {'status': 'in_progress'})
        r = self.client.patch(f'/api/v1/defects/{pk}/', {'status': 'resolved'})
        self.assertEqual(r.data['status'], 'resolved')

    def test_get_scoped(self):
        other = Marina.objects.create(name='Other Marina 4')
        oc = APIClient()
        oc.force_authenticate(make_user(other, 'other_defect@example.com'))
        oc.post('/api/v1/defects/', {'description': 'Other', 'severity': 'low'})
        self.client.post('/api/v1/defects/', {'description': 'Mine', 'severity': 'low'})
        r = self.client.get('/api/v1/defects/')
        descs = [d['description'] for d in (r.data.get('results') or r.data)]
        self.assertIn('Mine', descs)
        self.assertNotIn('Other', descs)


class DefectCreateTaskTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina, 'dct@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _create_defect(self, severity='medium'):
        r = self.client.post('/api/v1/defects/', {
            'description': 'Corroded handrail on pier A', 'severity': severity,
        })
        return r.data['id']

    def test_happy_path_creates_task_and_sets_defect_in_progress(self):
        pk = self._create_defect()
        self.client.patch(f'/api/v1/defects/{pk}/', {'status': 'acknowledged'})
        r = self.client.post(f'/api/v1/defects/{pk}/create-task/')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data['status'], 'pending')
        self.assertEqual(self.client.get(f'/api/v1/defects/{pk}/').data['status'], 'in_progress')

    def test_high_severity_sets_high_priority(self):
        pk = self._create_defect(severity='high')
        self.client.patch(f'/api/v1/defects/{pk}/', {'status': 'acknowledged'})
        r = self.client.post(f'/api/v1/defects/{pk}/create-task/')
        self.assertEqual(r.data['priority'], 'high')

    def test_medium_severity_sets_medium_priority(self):
        pk = self._create_defect(severity='medium')
        self.client.patch(f'/api/v1/defects/{pk}/', {'status': 'acknowledged'})
        r = self.client.post(f'/api/v1/defects/{pk}/create-task/')
        self.assertEqual(r.data['priority'], 'medium')

    def test_400_if_not_acknowledged(self):
        pk = self._create_defect()
        r = self.client.post(f'/api/v1/defects/{pk}/create-task/')
        self.assertEqual(r.status_code, 400)
        self.assertIn('acknowledged', r.data['detail'])

    def test_400_if_task_already_exists(self):
        pk = self._create_defect()
        self.client.patch(f'/api/v1/defects/{pk}/', {'status': 'acknowledged'})
        self.client.post(f'/api/v1/defects/{pk}/create-task/')
        r = self.client.post(f'/api/v1/defects/{pk}/create-task/')
        self.assertEqual(r.status_code, 400)
        self.assertIn('already exists', r.data['detail'])

    def test_links_defect_on_task(self):
        pk = self._create_defect()
        self.client.patch(f'/api/v1/defects/{pk}/', {'status': 'acknowledged'})
        r = self.client.post(f'/api/v1/defects/{pk}/create-task/')
        self.assertEqual(r.data['defect'], pk)


class MaintenanceTaskViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina, 'mt@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_create_task(self):
        r = self.client.post('/api/v1/maintenance-tasks/', {'title': 'Paint pontoon', 'priority': 'medium'})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data['title'], 'Paint pontoon')

    def test_patch_status_transitions(self):
        pk = self.client.post('/api/v1/maintenance-tasks/', {'title': 'Fix pump', 'priority': 'high'}).data['id']
        self.assertEqual(self.client.patch(f'/api/v1/maintenance-tasks/{pk}/', {'status': 'in_progress'}).data['status'], 'in_progress')
        self.assertEqual(self.client.patch(f'/api/v1/maintenance-tasks/{pk}/', {'status': 'blocked'}).data['status'], 'blocked')

    def test_patch_to_completed_sets_completed_at(self):
        pk = self.client.post('/api/v1/maintenance-tasks/', {'title': 'Replace rope', 'priority': 'low'}).data['id']
        r = self.client.patch(f'/api/v1/maintenance-tasks/{pk}/', {'status': 'completed'})
        self.assertIsNotNone(r.data['completed_at'])

    def test_completed_at_not_set_on_other_statuses(self):
        pk = self.client.post('/api/v1/maintenance-tasks/', {'title': 'New task', 'priority': 'low'}).data['id']
        r = self.client.patch(f'/api/v1/maintenance-tasks/{pk}/', {'status': 'in_progress'})
        self.assertIsNone(r.data['completed_at'])

    def test_multipart_patch_uploads_photo(self):
        import io
        pk = self.client.post('/api/v1/maintenance-tasks/', {'title': 'Rewire light', 'priority': 'medium'}).data['id']
        fake_photo = io.BytesIO(b'fake image data')
        fake_photo.name = 'photo.jpg'
        r = self.client.patch(
            f'/api/v1/maintenance-tasks/{pk}/',
            {'status': 'completed', 'completion_notes': 'Done', 'completion_photo': fake_photo},
            format='multipart',
        )
        self.assertEqual(r.status_code, 200)
        self.assertIsNotNone(r.data['completion_photo'])
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python manage.py test apps.maintenance.tests --settings=config.settings.dev -v 2 2>&1 | head -40
```

Expected: FAIL — serializers/views don't exist yet.

- [ ] **Step 3: Create serializers.py**

Create `backend/apps/maintenance/serializers.py`:

```python
from rest_framework import serializers
from .models import Task, Incident, Asset, Defect, MaintenanceTask


class TaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Task
        fields = ['id', 'text', 'location', 'priority', 'assigned_to', 'done', 'created_at']
        read_only_fields = ['created_at']


class IncidentSerializer(serializers.ModelSerializer):
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default='')
    berth_name = serializers.CharField(source='berth.name', read_only=True, default='')

    class Meta:
        model = Incident
        fields = [
            'id', 'vessel', 'vessel_name', 'berth', 'berth_name',
            'description', 'severity', 'reporter', 'notes',
            'resolved', 'occurred_at', 'created_at',
        ]
        read_only_fields = ['created_at']


class AssetSerializer(serializers.ModelSerializer):
    class Meta:
        model = Asset
        fields = [
            'id', 'name', 'category', 'location', 'make', 'model',
            'serial', 'purchased', 'cost', 'status', 'last_service',
            'next_service', 'total_maint_cost', 'notes',
        ]


class DefectSerializer(serializers.ModelSerializer):
    asset_name = serializers.CharField(source='asset.name', read_only=True, default='')

    class Meta:
        model = Defect
        fields = [
            'id', 'asset', 'asset_name', 'location', 'description',
            'severity', 'reporter', 'assigned_to', 'status', 'reported_at',
        ]
        read_only_fields = ['reported_at']


class MaintenanceTaskSerializer(serializers.ModelSerializer):
    asset_name = serializers.CharField(source='asset.name', read_only=True, default='')

    class Meta:
        model = MaintenanceTask
        fields = [
            'id', 'asset', 'asset_name', 'defect', 'title', 'description',
            'assigned_to', 'priority', 'status', 'due_date',
            'completed_at', 'completion_notes', 'completion_photo',
        ]
        read_only_fields = ['completed_at']
```

- [ ] **Step 4: Replace views.py**

Replace `backend/apps/maintenance/views.py` with:

```python
from django.utils import timezone
from django.db import transaction
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import Task, Incident, Asset, Defect, MaintenanceTask
from .serializers import (
    TaskSerializer, IncidentSerializer, AssetSerializer,
    DefectSerializer, MaintenanceTaskSerializer,
)


class TaskList(generics.ListCreateAPIView):
    serializer_class = TaskSerializer

    def get_queryset(self):
        return Task.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class TaskDetail(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = TaskSerializer

    def get_queryset(self):
        return Task.objects.filter(marina=self.request.user.marina)


class IncidentList(generics.ListCreateAPIView):
    serializer_class = IncidentSerializer

    def get_queryset(self):
        return Incident.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class IncidentDetail(generics.RetrieveUpdateAPIView):
    serializer_class = IncidentSerializer

    def get_queryset(self):
        return Incident.objects.filter(marina=self.request.user.marina)


class AssetList(generics.ListCreateAPIView):
    serializer_class = AssetSerializer

    def get_queryset(self):
        return Asset.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class AssetDetail(generics.RetrieveUpdateAPIView):
    serializer_class = AssetSerializer

    def get_queryset(self):
        return Asset.objects.filter(marina=self.request.user.marina)


class DefectList(generics.ListCreateAPIView):
    serializer_class = DefectSerializer

    def get_queryset(self):
        return Defect.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class DefectDetail(generics.RetrieveUpdateAPIView):
    serializer_class = DefectSerializer

    def get_queryset(self):
        return Defect.objects.filter(marina=self.request.user.marina)


class DefectCreateTaskView(APIView):
    def post(self, request, pk):
        with transaction.atomic():
            try:
                defect = Defect.objects.get(pk=pk, marina=request.user.marina)
            except Defect.DoesNotExist:
                return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

            if defect.status != 'acknowledged':
                return Response(
                    {'detail': 'Defect must be acknowledged before raising a task.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if MaintenanceTask.objects.filter(defect=defect).exists():
                return Response(
                    {'detail': 'A maintenance task already exists for this defect.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            task = MaintenanceTask.objects.create(
                marina=request.user.marina,
                defect=defect,
                asset=defect.asset,
                title=defect.description[:100],
                description=defect.description,
                priority='high' if defect.severity in ('high', 'critical') else 'medium',
                status='pending',
            )
            defect.status = 'in_progress'
            defect.save()

            return Response(MaintenanceTaskSerializer(task).data, status=status.HTTP_201_CREATED)


class MaintenanceTaskList(generics.ListCreateAPIView):
    serializer_class = MaintenanceTaskSerializer

    def get_queryset(self):
        return MaintenanceTask.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class MaintenanceTaskDetail(generics.RetrieveUpdateAPIView):
    serializer_class = MaintenanceTaskSerializer

    def get_queryset(self):
        return MaintenanceTask.objects.filter(marina=self.request.user.marina)

    def perform_update(self, serializer):
        if serializer.validated_data.get('status') == 'completed':
            serializer.save(completed_at=timezone.now())
        else:
            serializer.save()
```

- [ ] **Step 5: Replace urls.py**

Replace `backend/apps/maintenance/urls.py` with:

```python
from django.urls import path
from .views import (
    TaskList, TaskDetail,
    IncidentList, IncidentDetail,
    AssetList, AssetDetail,
    DefectList, DefectDetail, DefectCreateTaskView,
    MaintenanceTaskList, MaintenanceTaskDetail,
)

urlpatterns = [
    path('tasks/', TaskList.as_view()),
    path('tasks/<int:pk>/', TaskDetail.as_view()),
    path('incidents/', IncidentList.as_view()),
    path('incidents/<int:pk>/', IncidentDetail.as_view()),
    path('assets/', AssetList.as_view()),
    path('assets/<int:pk>/', AssetDetail.as_view()),
    path('defects/', DefectList.as_view()),
    path('defects/<int:pk>/', DefectDetail.as_view()),
    path('defects/<int:pk>/create-task/', DefectCreateTaskView.as_view()),
    path('maintenance-tasks/', MaintenanceTaskList.as_view()),
    path('maintenance-tasks/<int:pk>/', MaintenanceTaskDetail.as_view()),
]
```

- [ ] **Step 6: Update admin.py**

Replace `backend/apps/maintenance/admin.py` with:

```python
from django.contrib import admin
from .models import Task, Incident, Asset, Defect, MaintenanceTask

admin.site.register(Task)
admin.site.register(Incident)
admin.site.register(Asset)
admin.site.register(Defect)
admin.site.register(MaintenanceTask)
```

- [ ] **Step 7: Run full test suite**

```bash
cd backend && python manage.py test apps.maintenance.tests --settings=config.settings.dev -v 2
```

Expected: All tests PASS (3 model tests + 4 TaskView + 4 IncidentView + 3 AssetView + 4 DefectView + 6 DefectCreateTask + 5 MaintenanceTaskView = 29 tests).

- [ ] **Step 8: Commit**

```bash
git add backend/apps/maintenance/serializers.py backend/apps/maintenance/views.py backend/apps/maintenance/urls.py backend/apps/maintenance/admin.py backend/apps/maintenance/tests.py
git commit -m "feat(maintenance): serializers, views, URLs, admin — 11 endpoints + 29 tests"
```

---

### Task 4: Frontend Hooks

**Files:**
- Create: `frontend/src/hooks/useTasks.js`
- Create: `frontend/src/hooks/useIncidents.js`
- Create: `frontend/src/hooks/useDefects.js`
- Create: `frontend/src/hooks/useMaintenanceTasks.js`

- [ ] **Step 1: Create useTasks.js**

Create `frontend/src/hooks/useTasks.js`:

```javascript
import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/tasks/').then(r => setTasks(r.data.results ?? r.data)).finally(() => setLoading(false));
  }, []);

  async function createTask(payload) {
    const { data } = await api.post('/tasks/', payload);
    setTasks(prev => [...prev, data]);
    return data;
  }

  async function updateTask(id, payload) {
    const { data } = await api.patch(`/tasks/${id}/`, payload);
    setTasks(prev => prev.map(t => t.id === id ? data : t));
    return data;
  }

  async function deleteTask(id) {
    await api.delete(`/tasks/${id}/`);
    setTasks(prev => prev.filter(t => t.id !== id));
  }

  return { tasks, loading, createTask, updateTask, deleteTask };
}
```

- [ ] **Step 2: Create useIncidents.js**

Create `frontend/src/hooks/useIncidents.js`:

```javascript
import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useIncidents() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/incidents/').then(r => setIncidents(r.data.results ?? r.data)).finally(() => setLoading(false));
  }, []);

  async function createIncident(payload) {
    const { data } = await api.post('/incidents/', payload);
    setIncidents(prev => [data, ...prev]);
    return data;
  }

  async function updateIncident(id, payload) {
    const { data } = await api.patch(`/incidents/${id}/`, payload);
    setIncidents(prev => prev.map(i => i.id === id ? data : i));
    return data;
  }

  return { incidents, loading, createIncident, updateIncident };
}
```

- [ ] **Step 3: Create useDefects.js**

Create `frontend/src/hooks/useDefects.js`:

```javascript
import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useDefects() {
  const [defects, setDefects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/defects/').then(r => setDefects(r.data.results ?? r.data)).finally(() => setLoading(false));
  }, []);

  async function createDefect(payload) {
    const { data } = await api.post('/defects/', payload);
    setDefects(prev => [data, ...prev]);
    return data;
  }

  async function updateDefect(id, payload) {
    const { data } = await api.patch(`/defects/${id}/`, payload);
    setDefects(prev => prev.map(d => d.id === id ? data : d));
    return data;
  }

  async function raiseTask(id) {
    const { data } = await api.post(`/defects/${id}/create-task/`);
    setDefects(prev => prev.map(d => d.id === id ? { ...d, status: 'in_progress' } : d));
    return data;
  }

  return { defects, loading, createDefect, updateDefect, raiseTask };
}
```

- [ ] **Step 4: Create useMaintenanceTasks.js**

Create `frontend/src/hooks/useMaintenanceTasks.js`:

```javascript
import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useMaintenanceTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/maintenance-tasks/');
      setTasks(r.data.results ?? r.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  async function createTask(payload) {
    const { data } = await api.post('/maintenance-tasks/', payload);
    setTasks(prev => [...prev, data]);
    return data;
  }

  async function updateTask(id, payload) {
    const { data } = await api.patch(`/maintenance-tasks/${id}/`, payload);
    setTasks(prev => prev.map(t => t.id === id ? data : t));
    return data;
  }

  async function completeTask(id, notes, photo) {
    const form = new FormData();
    form.append('status', 'completed');
    form.append('completion_notes', notes);
    if (photo) form.append('completion_photo', photo);
    const { data } = await api.patch(`/maintenance-tasks/${id}/`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    setTasks(prev => prev.map(t => t.id === id ? data : t));
    return data;
  }

  return { tasks, loading, fetchTasks, createTask, updateTask, completeTask };
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useTasks.js frontend/src/hooks/useIncidents.js frontend/src/hooks/useDefects.js frontend/src/hooks/useMaintenanceTasks.js
git commit -m "feat(maintenance): add frontend hooks — useTasks, useIncidents, useDefects, useMaintenanceTasks"
```

---

### Task 5: Maintenance.jsx — 5 Tabs

**Files:**
- Replace: `frontend/src/screens/Maintenance.jsx`

The existing file imports from `../data/mock.js`. Replace the entire file.

- [ ] **Step 1: Replace Maintenance.jsx**

Replace `frontend/src/screens/Maintenance.jsx` with:

```jsx
import { useState } from 'react';
import Ic from '../components/ui/Icon.jsx';
import useTasks from '../hooks/useTasks.js';
import useIncidents from '../hooks/useIncidents.js';
import useAssets from '../hooks/useAssets.js';
import useDefects from '../hooks/useDefects.js';
import useMaintenanceTasks from '../hooks/useMaintenanceTasks.js';
import useVessels from '../hooks/useVessels.js';

const SEV_BADGE    = { low: 'badge-gray', medium: 'badge-orange', high: 'badge-red', critical: 'badge-red' };
const STATUS_BADGE = { open: 'badge-gold', acknowledged: 'badge-blue', in_progress: 'badge-teal', resolved: 'badge-green' };
const MT_PRI_BADGE = { low: 'badge-gray', medium: 'badge-orange', high: 'badge-red', urgent: 'badge-red' };

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Maintenance() {
  const [tab, setTab] = useState('tasks');

  const { tasks,                   loading: loadingTasks, createTask,  updateTask             } = useTasks();
  const { incidents,               loading: loadingInc,   createIncident, updateIncident      } = useIncidents();
  const { assets,                  loading: loadingAssets, createAsset                        } = useAssets();
  const { defects,                 loading: loadingDef,   createDefect, updateDefect, raiseTask } = useDefects();
  const { tasks: mTasks, fetchTasks: refetchMT, loading: loadingMT, createTask: createMT, updateTask: updateMT } = useMaintenanceTasks();
  const { vessels } = useVessels();

  // Staff Tasks modal
  const [showAddTask, setShowAddTask] = useState(false);
  const [taskForm, setTaskForm] = useState({ text: '', location: '', priority: 'medium', assigned_to: '' });

  // Maintenance Tasks modal
  const [showAddMT, setShowAddMT] = useState(false);
  const [mtForm, setMtForm] = useState({ title: '', asset: '', description: '', priority: 'medium', assigned_to: '', due_date: '' });

  // Incidents modal + inline note
  const [showAddInc, setShowAddInc] = useState(false);
  const [incForm, setIncForm] = useState({ vessel: '', occurred_at: '', severity: 'low', description: '', reporter: '' });
  const [noteTargetId, setNoteTargetId] = useState(null);
  const [noteText, setNoteText] = useState('');

  // Asset modal
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [assetForm, setAssetForm] = useState({ name: '', category: '', location: '', make: '', model: '', serial: '', purchased: '', cost: '' });

  // Defect modal
  const [showAddDefect, setShowAddDefect] = useState(false);
  const [defectForm, setDefectForm] = useState({ asset: '', location: '', severity: 'low', description: '', reporter: '' });

  const TABS = [
    ['tasks',     'Staff Tasks'],
    ['kanban',    'Maintenance Tasks'],
    ['incidents', 'Incidents'],
    ['assets',    'Asset Register'],
    ['defects',   'Defect Log'],
  ];

  const pColors = { high: 'var(--red)', medium: 'var(--orange)', low: 'rgba(0,0,0,0.25)' };

  const KANBAN_COLS = [
    { key: 'pending',     label: 'Pending' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'blocked',     label: 'Blocked' },
    { key: 'completed',   label: 'Completed' },
  ];

  function kanbanActions(t) {
    if (t.status === 'pending')     return [{ label: 'Start',    next: 'in_progress' }];
    if (t.status === 'in_progress') return [{ label: 'Block',    next: 'blocked'     }, { label: 'Complete', next: 'completed' }];
    if (t.status === 'blocked')     return [{ label: 'Resume',   next: 'in_progress' }];
    return [];
  }

  async function submitTask() {
    if (!taskForm.text.trim()) return;
    await createTask(taskForm);
    setTaskForm({ text: '', location: '', priority: 'medium', assigned_to: '' });
    setShowAddTask(false);
  }

  async function submitMT() {
    if (!mtForm.title.trim()) return;
    await createMT({ ...mtForm, asset: mtForm.asset || null, due_date: mtForm.due_date || null });
    setMtForm({ title: '', asset: '', description: '', priority: 'medium', assigned_to: '', due_date: '' });
    setShowAddMT(false);
  }

  async function submitIncident() {
    if (!incForm.description.trim() || !incForm.occurred_at) return;
    await createIncident({ ...incForm, vessel: incForm.vessel || null });
    setIncForm({ vessel: '', occurred_at: '', severity: 'low', description: '', reporter: '' });
    setShowAddInc(false);
  }

  async function saveNote(id) {
    await updateIncident(id, { notes: noteText });
    setNoteTargetId(null);
    setNoteText('');
  }

  async function submitAsset() {
    if (!assetForm.name.trim()) return;
    await createAsset({ ...assetForm, cost: assetForm.cost || null, purchased: assetForm.purchased || null });
    setAssetForm({ name: '', category: '', location: '', make: '', model: '', serial: '', purchased: '', cost: '' });
    setShowAddAsset(false);
  }

  async function submitDefect() {
    if (!defectForm.description.trim()) return;
    await createDefect({ ...defectForm, asset: defectForm.asset || null });
    setDefectForm({ asset: '', location: '', severity: 'low', description: '', reporter: '' });
    setShowAddDefect(false);
  }

  async function handleRaiseTask(id) {
    await raiseTask(id);
    await refetchMT();
  }

  return (
    <div>
      <div className="tabs">
        {TABS.map(([v, l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>

      {/* ===== STAFF TASKS ===== */}
      {tab === 'tasks' && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div>
            <div className="sec-hdr">
              <div className="sec-hdr-title">Today's Tasks</div>
              <button className="btn btn-primary btn-sm" onClick={() => setShowAddTask(true)}><Ic n="plus" s={11} />Add Task</button>
            </div>
            {loadingTasks ? <div className="loading">Loading…</div> : (
              <div className="card" style={{ padding: '4px 0' }}>
                {tasks.map(t => (
                  <div key={t.id} className="task-item" style={{ padding: '10px 18px' }}>
                    <div className={`task-check${t.done ? ' done' : ''}`} onClick={() => updateTask(t.id, { done: !t.done })}>
                      {t.done && <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><polyline points="2,6 5,9 10,3"/></svg>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className={`task-text${t.done ? ' done' : ''}`}>{t.text}</div>
                      <div className="task-meta">{t.location}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: pColors[t.priority] }} />
                      <div className="task-assign">{t.assigned_to}</div>
                    </div>
                  </div>
                ))}
                {tasks.length === 0 && <div style={{ padding: '16px 18px', fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>No tasks yet.</div>}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="card" style={{ padding: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Task Summary</div>
              {[
                ['Total tasks',   tasks.length,                                               'rgba(0,0,0,0.7)'],
                ['Completed',     tasks.filter(t => t.done).length,                           'var(--green)'],
                ['Open',          tasks.filter(t => !t.done).length,                          'var(--orange)'],
                ['High priority', tasks.filter(t => t.priority === 'high' && !t.done).length, 'var(--red)'],
              ].map(([l, v, c]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: 'var(--border)', fontSize: 12 }}>
                  <span style={{ color: 'rgba(0,0,0,0.5)' }}>{l}</span>
                  <span style={{ fontWeight: 700, color: c }}>{v}</span>
                </div>
              ))}
            </div>
            <div className="card" style={{ padding: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>By Assignment</div>
              {Array.from(new Set(tasks.filter(t => !t.done && t.assigned_to).map(t => t.assigned_to))).map(name => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: 'var(--border)' }}>
                  <span style={{ color: 'rgba(0,0,0,0.6)' }}>{name}</span>
                  <span style={{ fontWeight: 700 }}>{tasks.filter(t => t.assigned_to === name && !t.done).length} open</span>
                </div>
              ))}
              {tasks.filter(t => !t.done && t.assigned_to).length === 0 && (
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>No open assigned tasks.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== MAINTENANCE TASKS (KANBAN) ===== */}
      {tab === 'kanban' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Maintenance Tasks</div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddMT(true)}><Ic n="plus" s={11} />New Task</button>
          </div>
          {loadingMT ? <div className="loading">Loading…</div> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, alignItems: 'start' }}>
              {KANBAN_COLS.map(col => (
                <div key={col.key}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                    {col.label} <span style={{ fontWeight: 400 }}>({mTasks.filter(t => t.status === col.key).length})</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {mTasks.filter(t => t.status === col.key).map(t => (
                      <div key={t.id} className="card" style={{ padding: 14 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{t.title}</div>
                        {t.asset_name && <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>{t.asset_name}</div>}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                          <span className={`badge ${MT_PRI_BADGE[t.priority] ?? 'badge-gray'}`}>{t.priority}</span>
                          {t.assigned_to && <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)' }}>→ {t.assigned_to}</span>}
                        </div>
                        {t.due_date && <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 8 }}>Due {t.due_date}</div>}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {kanbanActions(t).map(action => (
                            <button key={action.next} className="btn btn-primary btn-sm" onClick={() => updateMT(t.id, { status: action.next })}>
                              {action.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {mTasks.filter(t => t.status === col.key).length === 0 && (
                      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.3)', padding: '12px 0' }}>Empty</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== INCIDENTS ===== */}
      {tab === 'incidents' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Incident Reports</div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowAddInc(true)}><Ic n="plus" s={11} />Log Incident</button>
          </div>
          {loadingInc ? <div className="loading">Loading…</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {incidents.map(inc => (
                <div key={inc.id} className="card" style={{ padding: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>INC-{inc.id}</div>
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.38)', marginTop: 2 }}>
                        {inc.occurred_at ? new Date(inc.occurred_at).toLocaleDateString() : ''} · Reported by {inc.reporter}
                      </div>
                    </div>
                    <span className={`badge ${SEV_BADGE[inc.severity] ?? 'badge-gray'}`}>{inc.severity}</span>
                  </div>
                  <div style={{ fontSize: 12, marginBottom: 10 }}>
                    {inc.vessel_name && <><b>Vessel:</b> {inc.vessel_name} &nbsp;·&nbsp;</>}
                    {inc.berth_name && <><b>Berth:</b> {inc.berth_name}</>}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)', lineHeight: 1.6, background: 'var(--bg)', borderRadius: 6, padding: '10px 12px', marginBottom: 10 }}>
                    {inc.description}
                  </div>
                  {inc.notes && (
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', background: '#fffbf0', borderRadius: 6, padding: '8px 12px', marginBottom: 10, borderLeft: '3px solid var(--orange)' }}>
                      <b>Note:</b> {inc.notes}
                    </div>
                  )}
                  {noteTargetId === inc.id ? (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <textarea
                        value={noteText}
                        onChange={e => setNoteText(e.target.value)}
                        placeholder="Add a note…"
                        style={{ flex: 1, padding: 8, fontSize: 12, borderRadius: 6, border: 'var(--border)', resize: 'vertical', minHeight: 60 }}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <button className="btn btn-primary btn-sm" onClick={() => saveNote(inc.id)}>Save</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setNoteTargetId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setNoteTargetId(inc.id); setNoteText(inc.notes || ''); }}>Add Note</button>
                      {!inc.resolved
                        ? <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => updateIncident(inc.id, { resolved: true })}>Mark Resolved</button>
                        : <span className="badge badge-green" style={{ marginLeft: 'auto' }}>Resolved</span>
                      }
                    </div>
                  )}
                </div>
              ))}
              {incidents.length === 0 && <div className="empty"><div className="empty-title">No incidents recorded.</div></div>}
            </div>
          )}
        </div>
      )}

      {/* ===== ASSET REGISTER ===== */}
      {tab === 'assets' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Asset Register</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="badge badge-orange">{assets.filter(a => a.status === 'due_service').length} Due Service</span>
              <span className="badge badge-red">{assets.filter(a => a.status === 'under_repair').length} Under Repair</span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowAddAsset(true)}><Ic n="plus" s={11} />Add Asset</button>
            </div>
          </div>
          {loadingAssets ? <div className="loading">Loading…</div> : (
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="tbl">
                <thead>
                  <tr><th>Asset</th><th>Category</th><th>Location</th><th>Make / Model</th><th>Status</th><th>Last Service</th><th>Next Due</th><th>Maint. Cost</th></tr>
                </thead>
                <tbody>
                  {assets.map(a => {
                    const stMap = {
                      ok:            ['badge-green',  'OK'],
                      due_service:   ['badge-orange', 'Due Service'],
                      under_repair:  ['badge-red',    'Under Repair'],
                      decommissioned:['badge-gray',   'Decommissioned'],
                    };
                    const [stBadge, stLabel] = stMap[a.status] ?? ['badge-gray', a.status];
                    return (
                      <tr key={a.id}>
                        <td><div className="tbl-name">{a.name}</div><div className="tbl-sub">{a.serial}</div></td>
                        <td><span className="badge badge-navy">{a.category}</span></td>
                        <td style={{ fontSize: 12 }}>{a.location}</td>
                        <td style={{ fontSize: 12 }}>{a.make} {a.model}</td>
                        <td><span className={`badge ${stBadge}`}>{stLabel}</span></td>
                        <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{a.last_service}</td>
                        <td style={{ fontSize: 12, fontWeight: 600, color: a.status === 'due_service' ? 'var(--orange)' : 'rgba(0,0,0,0.6)' }}>{a.next_service}</td>
                        <td style={{ fontSize: 12, fontWeight: 600 }}>${a.total_maint_cost}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {assets.length === 0 && <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>No assets registered.</div>}
            </div>
          )}
        </div>
      )}

      {/* ===== DEFECT LOG ===== */}
      {tab === 'defects' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Defect Log</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="badge badge-red">{defects.filter(d => d.severity === 'high').length} High</span>
              <span className="badge badge-orange">{defects.filter(d => d.severity === 'medium').length} Medium</span>
              <span className="badge badge-teal">{defects.filter(d => d.status === 'in_progress').length} In Progress</span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowAddDefect(true)}><Ic n="plus" s={11} />Log Defect</button>
            </div>
          </div>
          {loadingDef ? <div className="loading">Loading…</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {defects.map(d => (
                <div key={d.id} className="defect-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy)' }}>DEF-{d.id}</span>
                        <span className={`badge ${SEV_BADGE[d.severity] ?? 'badge-gray'}`}>{d.severity}</span>
                        <span className={`badge ${STATUS_BADGE[d.status] ?? 'badge-gray'}`}>{d.status.replace('_', ' ')}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{d.asset_name || 'No asset'}</div>
                      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>
                        {d.location}{d.location && ' · '}{d.reported_at ? new Date(d.reported_at).toLocaleDateString() : ''}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', textAlign: 'right', marginLeft: 16, flexShrink: 0 }}>
                      {d.assigned_to
                        ? <span style={{ fontWeight: 600, color: 'rgba(0,0,0,0.7)' }}>→ {d.assigned_to}</span>
                        : <span>Unassigned</span>
                      }
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.65)', lineHeight: 1.65, background: 'var(--bg)', borderRadius: 6, padding: '9px 12px', marginBottom: 12 }}>{d.description}</div>
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 12 }}>Reported by <b style={{ color: 'rgba(0,0,0,0.7)' }}>{d.reporter}</b></div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {d.status === 'open'         && <button className="btn btn-primary btn-sm" onClick={() => updateDefect(d.id, { status: 'acknowledged' })}>Acknowledge</button>}
                    {d.status === 'acknowledged' && <button className="btn btn-primary btn-sm" onClick={() => handleRaiseTask(d.id)}>Raise Maintenance Task</button>}
                    {d.status === 'in_progress'  && <button className="btn btn-primary btn-sm" onClick={() => updateDefect(d.id, { status: 'resolved' })}>Mark Resolved</button>}
                  </div>
                </div>
              ))}
              {defects.length === 0 && <div className="empty"><div className="empty-title">No defects logged.</div></div>}
            </div>
          )}
        </div>
      )}

      {/* ===== MODALS ===== */}

      {showAddTask && (
        <Modal title="Add Task" onClose={() => setShowAddTask(false)}>
          <div className="modal-body">
            <label className="field-label">Task description *</label>
            <input className="input" value={taskForm.text} onChange={e => setTaskForm(f => ({ ...f, text: e.target.value }))} placeholder="e.g. Inspect dock lines" />
            <label className="field-label">Location</label>
            <input className="input" value={taskForm.location} onChange={e => setTaskForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Pontoon B" />
            <label className="field-label">Priority</label>
            <select className="input" value={taskForm.priority} onChange={e => setTaskForm(f => ({ ...f, priority: e.target.value }))}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <label className="field-label">Assigned to</label>
            <input className="input" value={taskForm.assigned_to} onChange={e => setTaskForm(f => ({ ...f, assigned_to: e.target.value }))} placeholder="e.g. Dock Team A" />
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setShowAddTask(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submitTask}>Add Task</button>
          </div>
        </Modal>
      )}

      {showAddMT && (
        <Modal title="New Maintenance Task" onClose={() => setShowAddMT(false)}>
          <div className="modal-body">
            <label className="field-label">Title *</label>
            <input className="input" value={mtForm.title} onChange={e => setMtForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Repaint fuel pontoon" />
            <label className="field-label">Asset</label>
            <select className="input" value={mtForm.asset} onChange={e => setMtForm(f => ({ ...f, asset: e.target.value }))}>
              <option value="">— None —</option>
              {assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <label className="field-label">Description</label>
            <textarea className="input" value={mtForm.description} onChange={e => setMtForm(f => ({ ...f, description: e.target.value }))} placeholder="Details…" style={{ minHeight: 80 }} />
            <label className="field-label">Priority</label>
            <select className="input" value={mtForm.priority} onChange={e => setMtForm(f => ({ ...f, priority: e.target.value }))}>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <label className="field-label">Assigned to</label>
            <input className="input" value={mtForm.assigned_to} onChange={e => setMtForm(f => ({ ...f, assigned_to: e.target.value }))} placeholder="e.g. Yard Team 1" />
            <label className="field-label">Due date</label>
            <input type="date" className="input" value={mtForm.due_date} onChange={e => setMtForm(f => ({ ...f, due_date: e.target.value }))} />
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setShowAddMT(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submitMT}>Create Task</button>
          </div>
        </Modal>
      )}

      {showAddInc && (
        <Modal title="Log Incident" onClose={() => setShowAddInc(false)}>
          <div className="modal-body">
            <label className="field-label">Vessel</label>
            <select className="input" value={incForm.vessel} onChange={e => setIncForm(f => ({ ...f, vessel: e.target.value }))}>
              <option value="">— None —</option>
              {vessels.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <label className="field-label">Date & Time *</label>
            <input type="datetime-local" className="input" value={incForm.occurred_at} onChange={e => setIncForm(f => ({ ...f, occurred_at: e.target.value }))} />
            <label className="field-label">Severity</label>
            <select className="input" value={incForm.severity} onChange={e => setIncForm(f => ({ ...f, severity: e.target.value }))}>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <label className="field-label">Description *</label>
            <textarea className="input" value={incForm.description} onChange={e => setIncForm(f => ({ ...f, description: e.target.value }))} placeholder="What happened?" style={{ minHeight: 80 }} />
            <label className="field-label">Reporter</label>
            <input className="input" value={incForm.reporter} onChange={e => setIncForm(f => ({ ...f, reporter: e.target.value }))} placeholder="Name" />
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setShowAddInc(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submitIncident}>Log Incident</button>
          </div>
        </Modal>
      )}

      {showAddAsset && (
        <Modal title="Add Asset" onClose={() => setShowAddAsset(false)}>
          <div className="modal-body">
            <label className="field-label">Name *</label>
            <input className="input" value={assetForm.name} onChange={e => setAssetForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Travelift 50T" />
            <label className="field-label">Category</label>
            <input className="input" value={assetForm.category} onChange={e => setAssetForm(f => ({ ...f, category: e.target.value }))} placeholder="e.g. Crane" />
            <label className="field-label">Location</label>
            <input className="input" value={assetForm.location} onChange={e => setAssetForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Bay A" />
            <label className="field-label">Make</label>
            <input className="input" value={assetForm.make} onChange={e => setAssetForm(f => ({ ...f, make: e.target.value }))} />
            <label className="field-label">Model</label>
            <input className="input" value={assetForm.model} onChange={e => setAssetForm(f => ({ ...f, model: e.target.value }))} />
            <label className="field-label">Serial</label>
            <input className="input" value={assetForm.serial} onChange={e => setAssetForm(f => ({ ...f, serial: e.target.value }))} />
            <label className="field-label">Purchase date</label>
            <input type="date" className="input" value={assetForm.purchased} onChange={e => setAssetForm(f => ({ ...f, purchased: e.target.value }))} />
            <label className="field-label">Cost</label>
            <input type="number" className="input" value={assetForm.cost} onChange={e => setAssetForm(f => ({ ...f, cost: e.target.value }))} placeholder="0.00" />
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setShowAddAsset(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submitAsset}>Add Asset</button>
          </div>
        </Modal>
      )}

      {showAddDefect && (
        <Modal title="Log Defect" onClose={() => setShowAddDefect(false)}>
          <div className="modal-body">
            <label className="field-label">Asset</label>
            <select className="input" value={defectForm.asset} onChange={e => setDefectForm(f => ({ ...f, asset: e.target.value }))}>
              <option value="">— None —</option>
              {assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <label className="field-label">Location</label>
            <input className="input" value={defectForm.location} onChange={e => setDefectForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Pontoon A, Berth 7" />
            <label className="field-label">Severity</label>
            <select className="input" value={defectForm.severity} onChange={e => setDefectForm(f => ({ ...f, severity: e.target.value }))}>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <label className="field-label">Description *</label>
            <textarea className="input" value={defectForm.description} onChange={e => setDefectForm(f => ({ ...f, description: e.target.value }))} placeholder="What is defective?" style={{ minHeight: 80 }} />
            <label className="field-label">Reporter</label>
            <input className="input" value={defectForm.reporter} onChange={e => setDefectForm(f => ({ ...f, reporter: e.target.value }))} placeholder="Name" />
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" onClick={() => setShowAddDefect(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={submitDefect}>Log Defect</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend compiles**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/screens/Maintenance.jsx
git commit -m "feat(maintenance): wire Maintenance.jsx to real API — 5 tabs, all modals"
```

---

### Task 6: React Router + Field.jsx Mobile Route

**Files:**
- Modify: `frontend/package.json` (via npm install)
- Replace: `frontend/src/main.jsx`
- Replace: `frontend/src/App.jsx`
- Create: `frontend/src/screens/Field.jsx`

- [ ] **Step 1: Install react-router-dom**

```bash
cd frontend && npm install react-router-dom
```

Expected: `package.json` `dependencies` now includes `react-router-dom`.

- [ ] **Step 2: Replace main.jsx — wrap in BrowserRouter**

Replace `frontend/src/main.jsx` with:

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/tokens.css'
import './styles/app.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 3: Replace App.jsx — extract DesktopApp, add /field route**

Replace `frontend/src/App.jsx` with:

```jsx
import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar.jsx';
import Topbar  from './components/layout/Topbar.jsx';
import { isAuthenticated } from './api.js';

import Overview     from './screens/Overview.jsx';
import MarinaMap    from './screens/MarinaMap.jsx';
import Reservations from './screens/Reservations.jsx';
import Vessels      from './screens/Vessels.jsx';
import Boatyard     from './screens/Boatyard.jsx';
import Maintenance  from './screens/Maintenance.jsx';
import Staff        from './screens/Staff.jsx';
import Billing      from './screens/Billing.jsx';
import Reports      from './screens/Reports.jsx';
import Members      from './screens/Members.jsx';
import Restaurant   from './screens/Restaurant.jsx';
import Events       from './screens/Events.jsx';
import Settings     from './screens/Settings.jsx';
import Documents    from './screens/Documents.jsx';
import Sales        from './screens/Sales.jsx';
import Operations   from './screens/Operations.jsx';
import Field        from './screens/Field.jsx';

const SCREEN_MAP = {
  overview:     Overview,
  map:          MarinaMap,
  reservations: Reservations,
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
  operations:   Operations,
};

function ComingSoon() {
  return <div className="empty"><div className="empty-title">Coming soon.</div></div>;
}

function DesktopApp() {
  const [screen, setScreenRaw] = useState(
    () => localStorage.getItem('db_app_screen') || 'overview'
  );

  function setScreen(s) {
    setScreenRaw(s);
    localStorage.setItem('db_app_screen', s);
  }

  const Screen = SCREEN_MAP[screen] || ComingSoon;

  return (
    <div className="app">
      <Sidebar screen={screen} setScreen={setScreen} />
      <div className="main">
        <Topbar screen={screen} />
        <div className="content">
          <Screen setScreen={setScreen} />
        </div>
      </div>
    </div>
  );
}

function ProtectedField() {
  if (!isAuthenticated()) {
    window.location.href = '/';
    return null;
  }
  return <Field />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/field" element={<ProtectedField />} />
      <Route path="/*" element={<DesktopApp />} />
    </Routes>
  );
}
```

- [ ] **Step 4: Create Field.jsx**

Create `frontend/src/screens/Field.jsx`:

```jsx
import { useState } from 'react';
import useMaintenanceTasks from '../hooks/useMaintenanceTasks.js';

const PRIORITY_LABEL = { urgent: '🔥 Urgent', high: '🔥 High', medium: '🟠 Medium', low: '⬜ Low' };
const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };

export default function Field() {
  const { tasks, loading, updateTask, completeTask } = useMaintenanceTasks();
  const [selectedId, setSelectedId]       = useState(null);
  const [showCompletion, setShowCompletion] = useState(false);
  const [completionNotes, setCompletionNotes] = useState('');
  const [completionPhoto, setCompletionPhoto] = useState(null);
  const [submitting, setSubmitting]       = useState(false);

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

  const PINNED = {
    position: 'fixed', bottom: 0, left: 0, right: 0,
    padding: '12px 20px 28px', background: '#fff',
    borderTop: '1px solid rgba(0,0,0,0.1)',
  };

  const ACTION_BTN = {
    width: '100%', height: 60, borderRadius: 12,
    background: '#1a2d4a', color: '#fff',
    border: 'none', fontSize: 17, fontWeight: 700,
    cursor: 'pointer',
  };

  // Screen 3 — Completion Modal (slides up)
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

  // Screen 2 — Task Detail
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

          {selected.due_date && (
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 8 }}>Due: <b>{selected.due_date}</b></div>
          )}
          {selected.assigned_to && (
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)' }}>Assigned: <b>{selected.assigned_to}</b></div>
          )}
        </div>

        <div style={PINNED}>
          {selected.status === 'pending'     && <button style={ACTION_BTN} onClick={handleStart}>▶ START TASK</button>}
          {selected.status === 'in_progress' && <button style={ACTION_BTN} onClick={() => setShowCompletion(true)}>✔ MARK DONE</button>}
          {selected.status === 'blocked'     && <div style={{ textAlign: 'center', fontSize: 15, color: 'rgba(0,0,0,0.4)', fontWeight: 600, padding: '18px 0' }}>Blocked — contact manager</div>}
        </div>
      </div>
    );
  }

  // Screen 1 — Roster
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
            <div
              key={t.id}
              onClick={() => setSelectedId(t.id)}
              style={{ background: '#fff', borderRadius: 14, padding: 18, minHeight: 60, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
            >
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

- [ ] **Step 5: Verify frontend compiles**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/main.jsx frontend/src/App.jsx frontend/src/screens/Field.jsx frontend/package.json frontend/package-lock.json
git commit -m "feat(maintenance): add /field mobile route with react-router-dom and ProtectedField guard"
```

---

## Self-Review

1. **Spec coverage:** All 11 backend endpoints ✅ · `Incident.notes` ✅ · `MaintenanceTask` model ✅ · atomic DefectCreateTask transaction ✅ · `perform_update` sets `completed_at` on completion ✅ · 4 frontend hooks ✅ · `completeTask` multipart ✅ · `fetchTasks` exposed for post-raiseTask refresh ✅ · 5-tab Maintenance.jsx ✅ · Kanban 4 columns with click-to-move ✅ · Defect status buttons ✅ · react-router-dom ✅ · `ProtectedField` with `isAuthenticated()` ✅ · Field.jsx 3 screens ✅ · completion modal with photo ✅

2. **Placeholder scan:** None.

3. **Type consistency:** `createTask: createMT` / `updateTask: updateMT` renamed in Maintenance.jsx destructuring to avoid collision with `useTasks` names ✅ · `raiseTask(id)` in useDefects returns new MaintenanceTask data and is followed by `refetchMT()` in Maintenance.jsx ✅ · `fetchTasks` exported from `useMaintenanceTasks` and imported as `refetchMT` ✅ · `completed_at` read_only in serializer, set server-side in `perform_update` ✅

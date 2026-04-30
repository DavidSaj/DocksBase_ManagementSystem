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

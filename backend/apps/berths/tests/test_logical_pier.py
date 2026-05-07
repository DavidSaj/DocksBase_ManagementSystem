from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from apps.accounts.models import Marina
from apps.berths.models import LogicalPier, Pier

User = get_user_model()


class LogicalPierSerializerTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='mgr@example.com', password='pass', marina=self.marina
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_pier_serializer_includes_logical_pier_name(self):
        lp = LogicalPier.objects.create(marina=self.marina, name='Pier A', pier_type='pontoon')
        pier = Pier.objects.create(
            marina=self.marina, code='P1', pier_type='pontoon',
            canvas_x=10, canvas_y=10, logical_pier=lp,
        )
        resp = self.client.get(f'/api/v1/piers/{pier.id}/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['logical_pier'], lp.id)
        self.assertEqual(resp.data['logical_pier_name'], 'Pier A')

    def test_pier_serializer_includes_display_name_and_components(self):
        pier = Pier.objects.create(
            marina=self.marina, code='P2', pier_type='pontoon',
            canvas_x=5, canvas_y=5,
            display_name='North Dock',
            components=[{'id': 'c_abc', 'type': 'spine', 'ox': 0, 'oy': 0, 'w': 10, 'h': 2}],
        )
        resp = self.client.get(f'/api/v1/piers/{pier.id}/')
        self.assertEqual(resp.data['display_name'], 'North Dock')
        self.assertEqual(len(resp.data['components']), 1)
        self.assertEqual(resp.data['components'][0]['id'], 'c_abc')

    def test_components_non_numeric_rejected(self):
        resp = self.client.post('/api/v1/piers/', {
            'code': 'P3',
            'pier_type': 'pontoon',
            'canvas_x': 0,
            'canvas_y': 0,
            'components': [{'id': 'c_1', 'type': 'spine', 'ox': 'bad', 'oy': 0, 'w': 10, 'h': 2}],
        }, format='json')
        self.assertEqual(resp.status_code, 400)


class LogicalPierViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='mgr@example.com', password='pass', marina=self.marina
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_create_logical_pier(self):
        resp = self.client.post('/api/v1/logical-piers/', {
            'name': 'North Dock', 'pier_type': 'pontoon', 'notes': ''
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['name'], 'North Dock')
        self.assertEqual(LogicalPier.objects.filter(marina=self.marina).count(), 1)

    def test_list_logical_piers_scoped_to_marina(self):
        other_marina = Marina.objects.create(name='Other Marina')
        LogicalPier.objects.create(marina=self.marina, name='My Pier', pier_type='concrete')
        LogicalPier.objects.create(marina=other_marina, name='Other Pier', pier_type='concrete')
        resp = self.client.get('/api/v1/logical-piers/')
        self.assertEqual(resp.status_code, 200)
        names = [lp['name'] for lp in (resp.data.get('results') or resp.data)]
        self.assertIn('My Pier', names)
        self.assertNotIn('Other Pier', names)

    def test_delete_logical_pier_unassigns_dock_shapes(self):
        lp = LogicalPier.objects.create(marina=self.marina, name='Pier A', pier_type='pontoon')
        pier = Pier.objects.create(
            marina=self.marina, code='P1', pier_type='pontoon',
            canvas_x=10, canvas_y=10, logical_pier=lp,
        )
        resp = self.client.delete(f'/api/v1/logical-piers/{lp.id}/')
        self.assertEqual(resp.status_code, 204)
        pier.refresh_from_db()
        self.assertIsNone(pier.logical_pier)

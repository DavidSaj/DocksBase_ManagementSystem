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

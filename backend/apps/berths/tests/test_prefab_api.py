from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from apps.accounts.models import Marina, User
from apps.berths.models import MapPrefab


def make_user_with_marina(email='owner@test.com'):
    marina = Marina.objects.create(name=f'Test Marina {email}')
    user = User.objects.create_user(email=email, password='testpass', marina=marina)
    return user, marina


def auth_client(user):
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return client


SAMPLE_POLYGON = [[0,0],[10,0],[10,5],[0,5]]
SAMPLE_SLOTS = [{'x': 5, 'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12}]


class PrefabCRUDTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina()
        self.client = auth_client(self.user)

    def test_create_custom_prefab(self):
        resp = self.client.post('/api/v1/prefabs/', {
            'name': 'My Dock',
            'pier_type': 'concrete',
            'polygon_points': SAMPLE_POLYGON,
            'berth_slots': SAMPLE_SLOTS,
            'label_template': 'My Dock {n}',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data['name'], 'My Dock')
        self.assertFalse(data['is_base'])
        self.assertTrue(MapPrefab.objects.filter(marina=self.marina, name='My Dock').exists())

    def test_list_returns_own_and_base_prefabs(self):
        MapPrefab.objects.create(
            marina=None, name='Base Prefab', pier_type='pontoon',
            polygon_points=SAMPLE_POLYGON, is_base=True,
        )
        MapPrefab.objects.create(
            marina=self.marina, name='Custom Prefab', pier_type='concrete',
            polygon_points=SAMPLE_POLYGON,
        )
        _, other_marina = make_user_with_marina('other@test.com')
        MapPrefab.objects.create(
            marina=other_marina, name='Other Marina Prefab', pier_type='concrete',
            polygon_points=SAMPLE_POLYGON,
        )
        resp = self.client.get('/api/v1/prefabs/')
        self.assertEqual(resp.status_code, 200)
        names = {p['name'] for p in resp.json()}
        self.assertIn('Base Prefab', names)
        self.assertIn('Custom Prefab', names)
        self.assertNotIn('Other Marina Prefab', names)

    def test_cannot_delete_base_prefab(self):
        base = MapPrefab.objects.create(
            marina=None, name='Base', pier_type='pontoon',
            polygon_points=SAMPLE_POLYGON, is_base=True,
        )
        resp = self.client.delete(f'/api/v1/prefabs/{base.id}/')
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(MapPrefab.objects.filter(id=base.id).exists())

    def test_can_delete_own_prefab(self):
        prefab = MapPrefab.objects.create(
            marina=self.marina, name='To Delete', pier_type='concrete',
            polygon_points=SAMPLE_POLYGON,
        )
        resp = self.client.delete(f'/api/v1/prefabs/{prefab.id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(MapPrefab.objects.filter(id=prefab.id).exists())

    def test_cannot_access_other_marina_prefab(self):
        _, other_marina = make_user_with_marina('other2@test.com')
        other_prefab = MapPrefab.objects.create(
            marina=other_marina, name='Theirs', pier_type='concrete',
            polygon_points=SAMPLE_POLYGON,
        )
        resp = self.client.delete(f'/api/v1/prefabs/{other_prefab.id}/')
        self.assertEqual(resp.status_code, 404)

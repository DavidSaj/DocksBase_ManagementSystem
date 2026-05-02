from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from apps.accounts.models import Marina, User
from apps.berths.models import Pier


def make_user_with_marina(email='owner@test.com'):
    marina = Marina.objects.create(name=f'Test Marina {email}')
    user = User.objects.create_user(email=email, password='testpass', marina=marina)
    return user, marina


def auth_client(user):
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return client


class PierTypeFieldTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina()
        self.client = auth_client(self.user)

    def test_pier_type_defaults_to_concrete(self):
        pier = Pier.objects.create(
            marina=self.marina, code='A', polygon_points=[[0,0],[10,0],[10,5],[0,5]]
        )
        self.assertEqual(pier.pier_type, 'concrete')

    def test_pier_type_and_ghost_slots_in_api_response(self):
        resp = self.client.post('/api/v1/piers/', {
            'code': 'B',
            'pier_type': 'pontoon',
            'polygon_points': [[0,0],[10,0],[10,5],[0,5]],
            'ghost_slots': [],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data['pier_type'], 'pontoon')
        self.assertEqual(data['ghost_slots'], [])

    def test_ghost_slots_persisted_and_patchable(self):
        pier = Pier.objects.create(
            marina=self.marina, code='C', polygon_points=[[0,0],[10,0],[10,5],[0,5]]
        )
        slots = [{'x': 5, 'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12}]
        resp = self.client.patch(
            f'/api/v1/piers/{pier.id}/',
            {'ghost_slots': slots},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        pier.refresh_from_db()
        self.assertEqual(pier.ghost_slots, slots)


class PierSerializerValidationTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina('validation@test.com')
        self.client = auth_client(self.user)

    def test_invalid_pier_type_rejected(self):
        resp = self.client.post('/api/v1/piers/', {
            'code': 'X',
            'pier_type': 'invalid_type',
            'polygon_points': [[0,0],[10,0],[10,5],[0,5]],
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_ghost_slots_missing_key_rejected(self):
        pier = Pier.objects.create(
            marina=self.marina, code='Y', polygon_points=[[0,0],[5,0],[5,5],[0,5]]
        )
        resp = self.client.patch(
            f'/api/v1/piers/{pier.id}/',
            {'ghost_slots': [{'x': 1, 'y': 2}]},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_ghost_slots_non_numeric_value_rejected(self):
        pier = Pier.objects.create(
            marina=self.marina, code='Z', polygon_points=[[0,0],[5,0],[5,5],[0,5]]
        )
        resp = self.client.patch(
            f'/api/v1/piers/{pier.id}/',
            {'ghost_slots': [{'x': 'not-a-number', 'y': 2, 'rotation': 0, 'width_m': 4, 'height_m': 12}]},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)


class PierLabelTemplateTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina('label@test.com')
        self.client = auth_client(self.user)

    def test_n_template_resolved_to_1_when_no_existing(self):
        resp = self.client.post('/api/v1/piers/', {
            'code': 'Pontoon {n}',
            'pier_type': 'pontoon',
            'polygon_points': [[0,0],[10,0],[10,5],[0,5]],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['code'], 'Pontoon 1')

    def test_n_template_increments_when_collision(self):
        Pier.objects.create(marina=self.marina, code='Dock 1',
                            polygon_points=[[0,0],[5,0],[5,5],[0,5]])
        resp = self.client.post('/api/v1/piers/', {
            'code': 'Dock {n}',
            'pier_type': 'concrete',
            'polygon_points': [[0,0],[10,0],[10,5],[0,5]],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['code'], 'Dock 2')

    def test_code_without_template_saved_as_is(self):
        resp = self.client.post('/api/v1/piers/', {
            'code': 'A',
            'pier_type': 'concrete',
            'polygon_points': [[0,0],[10,0],[10,5],[0,5]],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['code'], 'A')

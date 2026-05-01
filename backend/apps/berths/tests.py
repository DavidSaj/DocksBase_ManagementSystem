from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Marina, User
from apps.berths.models import Pier, Berth


def make_marina(name='Test Marina'):
    return Marina.objects.create(name=name, currency='EUR')


def make_user(marina):
    i = User.objects.count()
    return User.objects.create_user(
        email=f'user{i}@test.com', password='pass', marina=marina, role='owner'
    )


def auth(client, user):
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')


def make_pier(marina, code='A', **kwargs):
    return Pier.objects.create(marina=marina, code=code, **kwargs)


def make_berth(marina, pier, code='A1', **kwargs):
    return Berth.objects.create(marina=marina, pier=pier, code=code, **kwargs)


# ── Pier CRUD ─────────────────────────────────────────────────────────────────

class PierCRUDTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        auth(self.client, self.user)

    def test_create_pier(self):
        resp = self.client.post('/api/v1/piers/', {
            'code': 'A', 'label': 'Pier Alpha',
            'canvas_x': 5, 'canvas_y': 10, 'canvas_width': 40, 'canvas_height': 8,
        })
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(Pier.objects.filter(code='A', marina=self.marina).exists())

    def test_list_piers(self):
        make_pier(self.marina, 'A')
        make_pier(self.marina, 'B')
        resp = self.client.get('/api/v1/piers/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 2)

    def test_pier_list_includes_berth_count(self):
        pier = make_pier(self.marina, 'A')
        make_berth(self.marina, pier, 'A1')
        make_berth(self.marina, pier, 'A2')
        resp = self.client.get('/api/v1/piers/')
        self.assertEqual(resp.json()[0]['berth_count'], 2)

    def test_update_pier_canvas_coords(self):
        pier = make_pier(self.marina, 'A')
        resp = self.client.patch(
            f'/api/v1/piers/{pier.id}/',
            {'canvas_x': 15.5, 'canvas_y': 20.0},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        pier.refresh_from_db()
        self.assertAlmostEqual(pier.canvas_x, 15.5)

    def test_delete_pier(self):
        pier = make_pier(self.marina, 'A')
        resp = self.client.delete(f'/api/v1/piers/{pier.id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Pier.objects.filter(id=pier.id).exists())

    def test_cannot_access_other_marina_pier(self):
        other = make_marina('Other')
        other_pier = make_pier(other, 'X')
        resp = self.client.get(f'/api/v1/piers/{other_pier.id}/')
        self.assertEqual(resp.status_code, 404)


# ── Berth CRUD ────────────────────────────────────────────────────────────────

class BerthCRUDTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        auth(self.client, self.user)
        self.pier = make_pier(self.marina, 'A')

    def test_create_berth(self):
        resp = self.client.post('/api/v1/berths/', {
            'code': 'A1', 'pier': self.pier.id, 'length_m': '12.0', 'max_beam_m': '4.0',
        })
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(Berth.objects.filter(code='A1', marina=self.marina).exists())

    def test_new_berth_is_unmapped(self):
        berth = make_berth(self.marina, self.pier, 'A1')
        self.assertIsNone(berth.canvas_x)
        resp = self.client.get(f'/api/v1/berths/{berth.id}/')
        self.assertTrue(resp.json()['unmapped'])

    def test_update_canvas_coords_maps_berth(self):
        berth = make_berth(self.marina, self.pier, 'A1')
        resp = self.client.patch(f'/api/v1/berths/{berth.id}/', {
            'canvas_x': 6.0, 'canvas_y': 11.0,
            'canvas_width': 4.0, 'canvas_height': 12.0, 'canvas_rotation': 0,
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        berth.refresh_from_db()
        self.assertAlmostEqual(berth.canvas_x, 6.0)
        self.assertFalse(resp.json()['unmapped'])

    def test_delete_berth(self):
        berth = make_berth(self.marina, self.pier, 'A1')
        resp = self.client.delete(f'/api/v1/berths/{berth.id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Berth.objects.filter(id=berth.id).exists())

    def test_filter_berths_by_pier(self):
        pier_b = make_pier(self.marina, 'B')
        make_berth(self.marina, self.pier, 'A1')
        make_berth(self.marina, pier_b, 'B1')
        resp = self.client.get(f'/api/v1/berths/?pier={self.pier.id}')
        self.assertEqual(resp.status_code, 200)
        codes = [b['code'] for b in resp.json()]
        self.assertIn('A1', codes)
        self.assertNotIn('B1', codes)

    def test_berth_serializer_includes_pier_code(self):
        berth = make_berth(self.marina, self.pier, 'A1')
        resp = self.client.get(f'/api/v1/berths/{berth.id}/')
        self.assertEqual(resp.json()['pier_code'], 'A')

    def test_cannot_access_other_marina_berth(self):
        other = make_marina('Other')
        other_pier = make_pier(other, 'X')
        other_berth = make_berth(other, other_pier, 'X1')
        resp = self.client.get(f'/api/v1/berths/{other_berth.id}/')
        self.assertEqual(resp.status_code, 404)


# ── Bulk Generate ─────────────────────────────────────────────────────────────

class BulkGenerateTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        auth(self.client, self.user)
        self.pier = make_pier(self.marina, 'A')
        self.url = f'/api/v1/piers/{self.pier.id}/bulk-generate/'

    def test_generates_correct_count(self):
        resp = self.client.post(self.url, {
            'prefix': 'A', 'start': 1, 'end': 10,
            'length_m': '12.0', 'max_beam_m': '4.0', 'price_per_night': '50.00',
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(len(resp.json()), 10)

    def test_generates_correct_codes(self):
        self.client.post(self.url, {'prefix': 'A', 'start': 1, 'end': 5})
        for i in range(1, 6):
            self.assertTrue(Berth.objects.filter(code=f'A{i}', marina=self.marina).exists())

    def test_generated_berths_are_unmapped(self):
        self.client.post(self.url, {'prefix': 'A', 'start': 1, 'end': 5})
        for berth in Berth.objects.filter(marina=self.marina):
            self.assertIsNone(berth.canvas_x)

    def test_skips_existing_codes(self):
        make_berth(self.marina, self.pier, 'A3')
        resp = self.client.post(self.url, {'prefix': 'A', 'start': 1, 'end': 5})
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(len(resp.json()), 4)  # A3 skipped

    def test_rejects_end_less_than_start(self):
        resp = self.client.post(self.url, {'prefix': 'A', 'start': 10, 'end': 5})
        self.assertEqual(resp.status_code, 400)

    def test_rejects_over_200_berths(self):
        resp = self.client.post(self.url, {'prefix': 'A', 'start': 1, 'end': 201})
        self.assertEqual(resp.status_code, 400)

    def test_cannot_generate_for_other_marina_pier(self):
        other = make_marina('Other')
        other_pier = make_pier(other, 'X')
        resp = self.client.post(
            f'/api/v1/piers/{other_pier.id}/bulk-generate/',
            {'prefix': 'X', 'start': 1, 'end': 5},
        )
        self.assertEqual(resp.status_code, 404)

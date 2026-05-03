from decimal import Decimal

from django.test import TestCase
from apps.accounts.models import Marina, User
from apps.berths.models import Pier, Berth
from apps.billing.models import ChargeableItem
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken


def make_user_with_marina(email='canvas@test.com'):
    marina = Marina.objects.create(name=f'Test Marina {email}')
    user = User.objects.create_user(email=email, password='testpass', marina=marina)
    return user, marina


def make_pricing_tier(marina):
    return ChargeableItem.objects.create(
        marina=marina, name='Berth Night', category='berth',
        pricing_model='per_night', unit_price=Decimal('50.00'),
    )


def auth_client(user):
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return client


class PierCanvasFieldsTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina()
        self.tier = make_pricing_tier(self.marina)

    def test_pier_canvas_fields_default_to_null_and_zero(self):
        pier = Pier.objects.create(marina=self.marina, code='A')
        self.assertIsNone(pier.canvas_x)
        self.assertIsNone(pier.canvas_y)
        self.assertEqual(pier.canvas_w, 2)
        self.assertEqual(pier.canvas_h, 10)
        self.assertEqual(pier.rotation, 0)

    def test_berth_pier_nullable(self):
        berth = Berth.objects.create(
            marina=self.marina,
            pier=None,
            code='X1',
            pricing_tier=self.tier,
        )
        self.assertIsNone(berth.pier)

    def test_berth_local_coords_default_null(self):
        berth = Berth.objects.create(marina=self.marina, pier=None, code='X2', pricing_tier=self.tier)
        self.assertIsNone(berth.local_x)
        self.assertIsNone(berth.local_y)
        self.assertIsNone(berth.position_on_parent)


class PierSerializerCanvasTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina('serial@test.com')
        self.client = auth_client(self.user)
        self.tier = make_pricing_tier(self.marina)

    def test_pier_api_returns_canvas_fields(self):
        resp = self.client.post('/api/v1/piers/', {
            'code': 'P1',
            'canvas_x': '5.50',
            'canvas_y': '8.00',
            'canvas_w': 1,
            'canvas_h': 8,
            'rotation': 0,
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data['canvas_x'], '5.50')
        self.assertEqual(data['canvas_y'], '8.00')
        self.assertEqual(data['canvas_w'], 1)
        self.assertEqual(data['canvas_h'], 8)

    def test_pier_canvas_position_patchable(self):
        pier = Pier.objects.create(marina=self.marina, code='P2')
        resp = self.client.patch(
            f'/api/v1/piers/{pier.id}/',
            {'canvas_x': '12.00', 'canvas_y': '6.50'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        pier.refresh_from_db()
        self.assertEqual(float(pier.canvas_x), 12.0)

    def test_berth_api_allows_null_pier(self):
        resp = self.client.post('/api/v1/berths/', {
            'code': 'B99',
            'pier': None,
            'pricing_tier': self.tier.id,
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertIsNone(resp.json()['pier'])

    def test_berth_local_coords_patchable(self):
        pier = Pier.objects.create(marina=self.marina, code='P3',
                                   canvas_x='10', canvas_y='5')
        berth = Berth.objects.create(marina=self.marina, pier=None, code='B1', pricing_tier=self.tier)
        resp = self.client.patch(
            f'/api/v1/berths/{berth.id}/',
            {
                'pier': pier.id,
                'local_x': '-3.00',
                'local_y': '0.00',
                'position_on_parent': {'side': 'port', 'slot_index': 0},
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        berth.refresh_from_db()
        self.assertEqual(berth.pier_id, pier.id)
        self.assertEqual(float(berth.local_x), -3.0)

    def test_berth_is_placed_false_when_no_pier(self):
        berth = Berth.objects.create(marina=self.marina, pier=None, code='B2', pricing_tier=self.tier)
        resp = self.client.get(f'/api/v1/berths/{berth.id}/')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()['is_placed'])

    def test_berth_is_placed_true_when_pier_and_local_x_set(self):
        pier = Pier.objects.create(marina=self.marina, code='P4',
                                   canvas_x='5', canvas_y='5')
        berth = Berth.objects.create(
            marina=self.marina, pier=pier, code='B3',
            local_x='1.00', local_y='0.00',
            pricing_tier=self.tier,
        )
        resp = self.client.get(f'/api/v1/berths/{berth.id}/')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()['is_placed'])

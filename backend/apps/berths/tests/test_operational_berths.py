from django.test import TestCase
from apps.accounts.models import Marina, User
from apps.berths.models import Berth
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken


def make_user_with_marina(email='ops@test.com'):
    marina = Marina.objects.create(name=f'Test Marina {email}')
    user = User.objects.create_user(email=email, password='testpass', marina=marina)
    return user, marina


def auth_client(user):
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return client


class BerthClassFieldsTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina()
        self.client = auth_client(self.user)

    def test_berth_defaults_to_standard_class(self):
        berth = Berth.objects.create(marina=self.marina, code='B1')
        self.assertEqual(berth.berth_class, 'standard')
        self.assertEqual(berth.operational_type, '')

    def test_fuel_dock_berth_filterable_via_api(self):
        Berth.objects.create(
            marina=self.marina, code='FD1',
            berth_class='operational', operational_type='fuel_dock',
        )
        Berth.objects.create(marina=self.marina, code='B2', berth_class='standard')
        resp = self.client.get('/api/v1/berths/?operational_type=fuel_dock')
        self.assertEqual(resp.status_code, 200)
        data = resp.data if isinstance(resp.data, list) else resp.data.get('results', [])
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['code'], 'FD1')

    def test_serializer_exposes_berth_class_and_operational_type(self):
        Berth.objects.create(
            marina=self.marina, code='FD2',
            berth_class='operational', operational_type='fuel_dock',
        )
        resp = self.client.get('/api/v1/berths/')
        self.assertEqual(resp.status_code, 200)
        data = resp.data if isinstance(resp.data, list) else resp.data.get('results', [])
        fd = next(b for b in data if b['code'] == 'FD2')
        self.assertEqual(fd['berth_class'], 'operational')
        self.assertEqual(fd['operational_type'], 'fuel_dock')

    def test_patch_berth_class_and_operational_type(self):
        berth = Berth.objects.create(marina=self.marina, code='FD3')
        resp = self.client.patch(f'/api/v1/berths/{berth.id}/', {
            'berth_class': 'operational',
            'operational_type': 'fuel_dock',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        berth.refresh_from_db()
        self.assertEqual(berth.berth_class, 'operational')
        self.assertEqual(berth.operational_type, 'fuel_dock')

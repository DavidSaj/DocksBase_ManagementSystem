from django.test import TestCase
from apps.accounts.models import Marina, User
from apps.berths.models import Pier, Berth
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken


def make_user_with_marina(email='canvas@test.com'):
    marina = Marina.objects.create(name=f'Test Marina {email}')
    user = User.objects.create_user(email=email, password='testpass', marina=marina)
    return user, marina


def auth_client(user):
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return client


class PierCanvasFieldsTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina()

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
        )
        self.assertIsNone(berth.pier)

    def test_berth_local_coords_default_null(self):
        berth = Berth.objects.create(marina=self.marina, pier=None, code='X2')
        self.assertIsNone(berth.local_x)
        self.assertIsNone(berth.local_y)
        self.assertIsNone(berth.position_on_parent)

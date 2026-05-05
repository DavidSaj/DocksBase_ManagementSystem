from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Marina, User
from apps.berths.models import Amenity, Pier


def make_user_with_marina(email='test@test.com'):
    marina = Marina.objects.create(name=f'Test Marina {email}')
    user = User.objects.create_user(email=email, password='testpass', marina=marina)
    return user, marina


def auth_client(user):
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return client


class AmenityAPITest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina('owner@test.com')
        self.client = auth_client(self.user)

    def test_create_amenity(self):
        resp = self.client.post('/api/v1/amenities/', {
            'label': 'Fuel Station',
            'type': 'fuel',
            'canvas_x': 10.0,
            'canvas_y': 20.0,
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data['label'], 'Fuel Station')
        self.assertEqual(data['type'], 'fuel')
        self.assertAlmostEqual(data['canvas_x'], 10.0)
        self.assertAlmostEqual(data['canvas_y'], 20.0)
        self.assertIn('id', data)
        self.assertTrue(Amenity.objects.filter(marina=self.marina, label='Fuel Station').exists())

    def test_list_amenities_scoped_to_marina(self):
        # Create one amenity for this marina
        Amenity.objects.create(marina=self.marina, label='My Shower', type='shower')

        # Create an amenity for another marina
        _, other_marina = make_user_with_marina('other@test.com')
        Amenity.objects.create(marina=other_marina, label='Their Parking', type='parking')

        resp = self.client.get('/api/v1/amenities/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['label'], 'My Shower')

    def test_patch_amenity(self):
        amenity = Amenity.objects.create(
            marina=self.marina, label='Water Point', type='water',
            canvas_x=5.0, canvas_y=10.0,
        )
        resp = self.client.patch(
            f'/api/v1/amenities/{amenity.id}/',
            {'canvas_x': 99.5},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        amenity.refresh_from_db()
        self.assertAlmostEqual(amenity.canvas_x, 99.5)
        self.assertAlmostEqual(resp.json()['canvas_x'], 99.5)

    def test_delete_amenity(self):
        amenity = Amenity.objects.create(
            marina=self.marina, label='To Delete', type='other',
        )
        resp = self.client.delete(f'/api/v1/amenities/{amenity.id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Amenity.objects.filter(id=amenity.id).exists())

    def test_cannot_access_other_marina_amenity(self):
        other_user, other_marina = make_user_with_marina('other2@test.com')
        other_amenity = Amenity.objects.create(
            marina=other_marina, label='Their WiFi', type='wifi',
            canvas_x=0.0, canvas_y=0.0,
        )
        resp = self.client.patch(
            f'/api/v1/amenities/{other_amenity.id}/',
            {'canvas_x': 50.0},
            format='json',
        )
        self.assertEqual(resp.status_code, 404)

    def test_pier_polygon_points_field(self):
        points = [[0, 0], [10, 0], [10, 5], [0, 5]]
        resp = self.client.post('/api/v1/piers/', {
            'code': 'P1',
            'label': 'Main Pier',
            'polygon_points': points,
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertIn('polygon_points', data)
        self.assertEqual(data['polygon_points'], points)
        # Verify persisted
        pier = Pier.objects.get(marina=self.marina, code='P1')
        self.assertEqual(pier.polygon_points, points)

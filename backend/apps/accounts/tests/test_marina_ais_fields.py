from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Marina, User


class MarinaAISFieldExposureTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='M', lat=Decimal('52.0'), lng=Decimal('1.0'),
        )
        self.user = User.objects.create_user(
            email='owner@m', password='x', marina=self.marina,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_patch_basin_polygon_persists(self):
        poly = [[51.99, 0.99], [51.99, 1.01], [52.01, 1.01], [52.01, 0.99]]
        r = self.client.patch('/api/v1/marina/profile/', {'basin_polygon': poly}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.marina.refresh_from_db()
        self.assertEqual(self.marina.basin_polygon, poly)

    def test_rejects_polygon_with_two_vertices(self):
        r = self.client.patch('/api/v1/marina/profile/',
                              {'basin_polygon': [[1.0, 1.0], [2.0, 2.0]]},
                              format='json')
        self.assertEqual(r.status_code, 400)

    def test_rejects_lat_out_of_range(self):
        r = self.client.patch('/api/v1/marina/profile/',
                              {'basin_polygon': [[100.0, 1.0], [1.0, 1.0], [2.0, 2.0]]},
                              format='json')
        self.assertEqual(r.status_code, 400)

    def test_empty_polygon_is_allowed(self):
        self.marina.basin_polygon = [[1.0, 1.0], [2.0, 2.0], [3.0, 3.0]]
        self.marina.save(update_fields=['basin_polygon'])
        r = self.client.patch('/api/v1/marina/profile/', {'basin_polygon': []}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.marina.refresh_from_db()
        self.assertEqual(self.marina.basin_polygon, [])

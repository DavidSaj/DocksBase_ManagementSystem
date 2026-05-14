import math

from django.test import TestCase

from apps.ais.geometry import bearing_deg, haversine_nm, point_in_polygon


class GeometryTests(TestCase):
    def test_haversine_zero_distance(self):
        self.assertAlmostEqual(haversine_nm(52.0, 1.0, 52.0, 1.0), 0.0, places=3)

    def test_haversine_one_degree_latitude(self):
        # 1° of latitude ≈ 60 nautical miles (definition of nm).
        d = haversine_nm(52.0, 1.0, 53.0, 1.0)
        self.assertAlmostEqual(d, 60.0, delta=0.5)

    def test_haversine_known_pair(self):
        # Harwich (~51.945°N 1.283°E) to Felixstowe (~51.961°N 1.347°E)
        # is roughly 2.7 nm by sea — accept anything in [2.2, 3.2].
        d = haversine_nm(51.945, 1.283, 51.961, 1.347)
        self.assertGreater(d, 2.2)
        self.assertLess(d, 3.2)

    def test_bearing_due_north_is_zero(self):
        self.assertAlmostEqual(bearing_deg(52.0, 1.0, 53.0, 1.0), 0.0, delta=0.5)

    def test_bearing_due_east_is_90(self):
        self.assertAlmostEqual(bearing_deg(52.0, 1.0, 52.0, 2.0), 90.0, delta=0.5)

    def test_point_in_polygon_inside(self):
        # Simple square: [(0,0), (0,10), (10,10), (10,0)]
        poly = [(0.0, 0.0), (0.0, 10.0), (10.0, 10.0), (10.0, 0.0)]
        self.assertTrue(point_in_polygon(5.0, 5.0, poly))

    def test_point_in_polygon_outside(self):
        poly = [(0.0, 0.0), (0.0, 10.0), (10.0, 10.0), (10.0, 0.0)]
        self.assertFalse(point_in_polygon(15.0, 5.0, poly))

    def test_point_in_polygon_empty(self):
        self.assertFalse(point_in_polygon(5.0, 5.0, []))

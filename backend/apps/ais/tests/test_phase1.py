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


from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

from apps.ais.adapters.base import AISReading
from apps.ais.adapters.marinetraffic import MarineTrafficAdapter


class MarineTrafficAdapterTests(TestCase):
    BBOX = (51.0, 53.0, 0.5, 2.5)  # minlat, maxlat, minlng, maxlng

    @patch('apps.ais.adapters.marinetraffic.requests.get')
    def test_fetch_positions_returns_readings(self, mock_get):
        # MT 'simple' protocol returns a list of dicts.
        mock_get.return_value = MagicMock(
            ok=True,
            status_code=200,
            json=lambda: [
                {
                    'MMSI': '227123456',
                    'LAT': '52.105',
                    'LON': '1.420',
                    'SPEED': '94',     # tenths of knots
                    'COURSE': '142',
                    'HEADING': '140',
                    'STATUS': '0',
                    'TIMESTAMP': '2026-05-14T15:04:00',
                },
            ],
        )
        adapter = MarineTrafficAdapter(api_key='fake')
        readings = adapter.fetch_positions(self.BBOX)
        self.assertEqual(len(readings), 1)
        r = readings[0]
        self.assertEqual(r.mmsi, '227123456')
        self.assertAlmostEqual(float(r.lat), 52.105, places=3)
        self.assertAlmostEqual(float(r.speed_kn), 9.4, places=1)
        self.assertEqual(r.reported_at.year, 2026)

    @patch('apps.ais.adapters.marinetraffic.requests.get')
    def test_fetch_positions_raises_on_4xx(self, mock_get):
        mock_get.return_value = MagicMock(ok=False, status_code=401, text='unauthorized')
        adapter = MarineTrafficAdapter(api_key='bad')
        with self.assertRaises(Exception):
            adapter.fetch_positions(self.BBOX)

    @patch('apps.ais.adapters.marinetraffic.requests.get')
    def test_fetch_positions_drops_malformed(self, mock_get):
        mock_get.return_value = MagicMock(
            ok=True, status_code=200,
            json=lambda: [
                {'MMSI': 'bad', 'LAT': 'x', 'LON': 'y'},  # malformed
                {'MMSI': '227000001', 'LAT': '52.1', 'LON': '1.0',
                 'SPEED': '0', 'COURSE': '0', 'HEADING': '0',
                 'STATUS': '5', 'TIMESTAMP': '2026-05-14T15:04:00'},
            ],
        )
        readings = MarineTrafficAdapter(api_key='fake').fetch_positions(self.BBOX)
        self.assertEqual(len(readings), 1)
        self.assertEqual(readings[0].mmsi, '227000001')

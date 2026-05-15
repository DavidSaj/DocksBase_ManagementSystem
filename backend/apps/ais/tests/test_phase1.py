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


from datetime import date, timedelta
from decimal import Decimal

from django.utils import timezone

from apps.accounts.models import Marina
from apps.vessels.models import Vessel
from apps.berths.models import Berth
from apps.reservations.models import Booking
from apps.ais.adapters.base import AISReading
from apps.ais.models import VesselPosition
from apps.ais.services import get_inbound_etas, upsert_position


def _make_reading(mmsi='227123456', lat=52.0, lng=1.0, speed=10.0):
    return AISReading(
        mmsi=mmsi,
        lat=Decimal(str(lat)),
        lng=Decimal(str(lng)),
        speed_kn=Decimal(str(speed)),
        course_deg=0, heading_deg=0, nav_status='',
        reported_at=timezone.now(),
    )


class UpsertPositionTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Harwich', lat=Decimal('51.945'), lng=Decimal('1.283'))
        self.vessel = Vessel.objects.create(marina=self.marina, name='Wanderer', mmsi='227123456')

    def test_first_upsert_creates_row(self):
        reading = _make_reading()
        pos = upsert_position(self.marina, reading, vessel=self.vessel)
        self.assertEqual(VesselPosition.objects.count(), 1)
        self.assertEqual(pos.vessel_id, self.vessel.id)

    def test_second_upsert_updates_in_place(self):
        upsert_position(self.marina, _make_reading(lat=52.0))
        upsert_position(self.marina, _make_reading(lat=52.5))
        self.assertEqual(VesselPosition.objects.count(), 1)
        pos = VesselPosition.objects.get()
        self.assertAlmostEqual(float(pos.lat), 52.5, places=3)

    def test_unmatched_mmsi_leaves_vessel_null(self):
        upsert_position(self.marina, _make_reading(mmsi='999999999'))
        pos = VesselPosition.objects.get(mmsi='999999999')
        self.assertIsNone(pos.vessel_id)


class GetInboundETAsTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Harwich', lat=Decimal('51.945'), lng=Decimal('1.283'))
        self.vessel = Vessel.objects.create(marina=self.marina, name='Wanderer', mmsi='227123456')
        self.berth = Berth.objects.create(marina=self.marina, code='A1')
        self.booking = Booking.objects.create(
            marina=self.marina, berth=self.berth, vessel=self.vessel,
            check_in=date.today(), check_out=date.today() + timedelta(days=1),
            status='confirmed',
        )

    def test_inbound_returns_booking_with_eta(self):
        upsert_position(self.marina, _make_reading(lat=52.0, lng=1.5, speed=10.0))
        rows = get_inbound_etas(self.marina)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['booking_id'], self.booking.id)
        self.assertGreater(rows[0]['distance_nm'], 0)
        self.assertGreater(rows[0]['eta_minutes'], 0)
        # eta must be ISO 8601 — not pre-formatted HH:MM (timezone safety).
        self.assertIn('T', rows[0]['eta'])

    def test_no_ais_returns_empty(self):
        self.assertEqual(get_inbound_etas(self.marina), [])

    def test_other_marina_invisible(self):
        other = Marina.objects.create(name='Felixstowe', lat=Decimal('51.961'), lng=Decimal('1.347'))
        upsert_position(other, _make_reading())
        self.assertEqual(get_inbound_etas(self.marina), [])

    def test_distant_vessel_filtered_out(self):
        # 60 nm north of Harwich — outside the 50 nm default.
        upsert_position(self.marina, _make_reading(lat=53.0, lng=1.283, speed=8))
        self.assertEqual(get_inbound_etas(self.marina, max_distance_nm=50), [])


from unittest.mock import patch

from apps.ais.tasks import poll_ais_for_marina


class PollTaskTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='Harwich',
            lat=Decimal('51.945'), lng=Decimal('1.283'),
            marinetraffic_api_key='fake',
            ais_poll_radius_nm=10,
        )

    @patch('apps.ais.tasks.MarineTrafficAdapter')
    def test_poll_creates_positions(self, MockAdapter):
        MockAdapter.return_value.fetch_positions.return_value = [_make_reading()]
        poll_ais_for_marina(self.marina.id)
        self.assertEqual(VesselPosition.objects.count(), 1)

    @patch('apps.ais.tasks.MarineTrafficAdapter')
    def test_missing_key_skips(self, MockAdapter):
        Marina.objects.filter(pk=self.marina.pk).update(marinetraffic_api_key='')
        poll_ais_for_marina(self.marina.id)
        MockAdapter.assert_not_called()
        self.assertEqual(VesselPosition.objects.count(), 0)

    @patch('apps.ais.tasks.MarineTrafficAdapter')
    def test_provider_failure_is_swallowed(self, MockAdapter):
        MockAdapter.return_value.fetch_positions.side_effect = RuntimeError('401')
        # Must not raise.
        poll_ais_for_marina(self.marina.id)
        self.assertEqual(VesselPosition.objects.count(), 0)


from rest_framework.test import APIClient
from apps.accounts.models import User


class InboundETAViewTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='Harwich', lat=Decimal('51.945'), lng=Decimal('1.283'),
        )
        self.other = Marina.objects.create(
            name='Felixstowe', lat=Decimal('51.961'), lng=Decimal('1.347'),
        )
        self.user = User.objects.create_user(
            email='hm@harwich.test', password='pw',
            marina=self.marina, role='manager',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

        self.vessel = Vessel.objects.create(marina=self.marina, name='Wanderer', mmsi='227123456')
        self.berth = Berth.objects.create(marina=self.marina, code='A1')
        Booking.objects.create(
            marina=self.marina, berth=self.berth, vessel=self.vessel,
            check_in=date.today(), check_out=date.today() + timedelta(days=1),
            status='confirmed',
        )
        upsert_position(self.marina, _make_reading(lat=52.0, lng=1.5, speed=8))

    def test_returns_inbound_rows(self):
        r = self.client.get('/api/v1/ais/inbound/')
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIn('inbound', body)
        self.assertEqual(len(body['inbound']), 1)
        row = body['inbound'][0]
        self.assertEqual(row['mmsi'], '227123456')
        self.assertIn('eta_minutes', row)
        self.assertIn('fetched_at', body)

    def test_unauthenticated_returns_401(self):
        anon = APIClient()
        r = anon.get('/api/v1/ais/inbound/')
        self.assertEqual(r.status_code, 401)

    def test_scoped_to_user_marina(self):
        # Seed the other marina with a vessel + booking + position.
        v = Vessel.objects.create(marina=self.other, name='Otter', mmsi='227999999')
        bt = Berth.objects.create(marina=self.other, code='B1')
        Booking.objects.create(
            marina=self.other, berth=bt, vessel=v,
            check_in=date.today(), check_out=date.today() + timedelta(days=1),
            status='confirmed',
        )
        upsert_position(self.other, _make_reading(mmsi='227999999', lat=51.97, lng=1.35))

        r = self.client.get('/api/v1/ais/inbound/')
        body = r.json()
        mmsis = [row['mmsi'] for row in body['inbound']]
        self.assertIn('227123456', mmsis)
        self.assertNotIn('227999999', mmsis)

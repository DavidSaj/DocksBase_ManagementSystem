from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from django.test import SimpleTestCase, TestCase

from apps.ais.detect_events import DWELL, compute_transition


SQUARE = [(0.0, 0.0), (0.0, 10.0), (10.0, 10.0), (10.0, 0.0)]
NOW = datetime(2026, 5, 15, 12, 0, tzinfo=timezone.utc)


def prev(in_basin, last_transition_at=None):
    return SimpleNamespace(in_basin=in_basin, last_transition_at=last_transition_at)


class ComputeTransitionTests(SimpleTestCase):
    def test_no_polygon_returns_no_transition(self):
        in_basin, last, t = compute_transition(prev(False), 5.0, 5.0, [], NOW)
        self.assertFalse(in_basin)
        self.assertIsNone(t)

    def test_polygon_too_few_vertices(self):
        _, _, t = compute_transition(prev(False), 5.0, 5.0, [(0.0, 0.0), (1.0, 1.0)], NOW)
        self.assertIsNone(t)

    def test_first_sighting_inside_fires_enter(self):
        in_basin, last, t = compute_transition(None, 5.0, 5.0, SQUARE, NOW)
        self.assertTrue(in_basin)
        self.assertEqual(t, 'enter')
        self.assertEqual(last, NOW)

    def test_first_sighting_outside_no_event(self):
        in_basin, last, t = compute_transition(None, 50.0, 50.0, SQUARE, NOW)
        self.assertFalse(in_basin)
        self.assertIsNone(t)

    def test_no_change_no_event(self):
        p = prev(in_basin=True, last_transition_at=NOW - timedelta(hours=1))
        in_basin, last, t = compute_transition(p, 5.0, 5.0, SQUARE, NOW)
        self.assertTrue(in_basin)
        self.assertIsNone(t)
        self.assertEqual(last, p.last_transition_at)

    def test_exit_after_dwell_fires(self):
        p = prev(in_basin=True, last_transition_at=NOW - DWELL - timedelta(seconds=1))
        in_basin, last, t = compute_transition(p, 50.0, 50.0, SQUARE, NOW)
        self.assertFalse(in_basin)
        self.assertEqual(t, 'exit')

    def test_exit_within_dwell_is_suppressed(self):
        p = prev(in_basin=True, last_transition_at=NOW - timedelta(minutes=2))
        in_basin, last, t = compute_transition(p, 50.0, 50.0, SQUARE, NOW)
        self.assertTrue(in_basin)
        self.assertIsNone(t)
        self.assertEqual(last, p.last_transition_at)

    def test_enter_after_dwell_fires(self):
        p = prev(in_basin=False, last_transition_at=NOW - DWELL - timedelta(seconds=1))
        in_basin, last, t = compute_transition(p, 5.0, 5.0, SQUARE, NOW)
        self.assertTrue(in_basin)
        self.assertEqual(t, 'enter')


from decimal import Decimal

from django.utils import timezone

from apps.accounts.models import Marina
from apps.ais.adapters.base import AISReading
from apps.ais.models import VesselPosition
from apps.ais.services import upsert_position


class UpsertPositionSignatureTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='M', lat=Decimal('52.0'), lng=Decimal('1.0'),
        )
        self.reading = AISReading(
            mmsi='227111111',
            lat=Decimal('52.001'),
            lng=Decimal('1.001'),
            speed_kn=Decimal('5.0'),
            course_deg=180,
            heading_deg=180,
            nav_status='UnderwayUsingEngine',
            reported_at=timezone.now(),
        )

    def test_upsert_persists_in_basin_and_last_transition_in_one_row(self):
        now = timezone.now()
        position, transition = upsert_position(
            self.marina, self.reading, vessel=None,
            in_basin=True, last_transition_at=now, transition='enter',
        )
        self.assertTrue(position.in_basin)
        self.assertEqual(position.last_transition_at, now)
        self.assertEqual(transition, 'enter')

    def test_upsert_second_call_updates_same_row(self):
        upsert_position(self.marina, self.reading, vessel=None,
                        in_basin=False, last_transition_at=None, transition=None)
        upsert_position(self.marina, self.reading, vessel=None,
                        in_basin=True,
                        last_transition_at=timezone.now(),
                        transition='enter')
        self.assertEqual(
            VesselPosition.objects.filter(
                marina=self.marina, mmsi=self.reading.mmsi,
            ).count(),
            1,
        )

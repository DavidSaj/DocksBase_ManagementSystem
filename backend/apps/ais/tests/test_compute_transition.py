from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from django.test import SimpleTestCase

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

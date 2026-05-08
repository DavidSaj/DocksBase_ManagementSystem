"""
Tests for YieldEngine.

Covers 9 scenarios:
  1. No rule fires — base price returned unchanged.
  2. Occupancy threshold fires at tier scope.
  3. Occupancy threshold fires at marina scope.
  4. Days-to-arrival fires.
  5. Gap-fill fires.
  6. Seasonal booking type guard (non-transient returns base immediately).
  7. Floor clamp (nightly pricing).
  8. Floor clamp (hourly pricing — floor_price/24 conversion).
  9. Ceiling clamp.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch, PropertyMock

from django.test import TestCase

from apps.revenue_intelligence.engine import YieldEngine


def _make_marina(id=1):
    m = MagicMock()
    m.pk = id
    m.id = id
    return m


def _make_berth(
    pricing_tier_price='100.00',
    booking_tier_premium='0',
    has_booking_tier=False,
    has_hourly_config=False,
    hourly_price='20.00',
    length_m=None,
):
    berth = MagicMock()
    berth.length_m = length_m

    # pricing_tier (ChargeableItem)
    pt = MagicMock()
    pt.unit_price = Decimal(pricing_tier_price)
    berth.pricing_tier = pt

    # booking_tier (BookingTier) — optional
    if has_booking_tier:
        bt = MagicMock()
        bt.rate_premium_pct = Decimal(booking_tier_premium)
        berth.booking_tier = bt
    else:
        berth.booking_tier = None
        # Accessing .booking_tier.rate_premium_pct should raise AttributeError.
        type(berth).booking_tier = PropertyMock(return_value=None)

    # hourly_config — optional
    if has_hourly_config:
        hc = MagicMock()
        hc.pricing_item.unit_price = Decimal(hourly_price)
        berth.hourly_config = hc
    else:
        type(berth).hourly_config = PropertyMock(side_effect=AttributeError)

    return berth


def _make_rule(
    trigger_type='occupancy_threshold',
    action_type='percent_uplift',
    action_value='20',
    occupancy_scope='marina',
    occupancy_threshold_pct='80',
    days_to_arrival_lte=None,
    days_in_advance_gte=None,
    gap_max_nights=None,
    floor_price=None,
    ceiling_price=None,
    pricing_model_scope='all',
    valid_from=None,
    valid_until=None,
    priority=10,
    booking_tier_id=None,
    name='Test Rule',
):
    rule = MagicMock()
    rule.name = name
    rule.trigger_type = trigger_type
    rule.action_type = action_type
    rule.action_value = Decimal(action_value)
    rule.occupancy_scope = occupancy_scope
    rule.occupancy_threshold_pct = Decimal(occupancy_threshold_pct) if occupancy_threshold_pct else None
    rule.days_to_arrival_lte = days_to_arrival_lte
    rule.days_in_advance_gte = days_in_advance_gte
    rule.gap_max_nights = gap_max_nights
    rule.floor_price = Decimal(str(floor_price)) if floor_price is not None else None
    rule.ceiling_price = Decimal(str(ceiling_price)) if ceiling_price is not None else None
    rule.pricing_model_scope = pricing_model_scope
    rule.valid_from = valid_from
    rule.valid_until = valid_until
    rule.priority = priority
    rule.booking_tier_id = booking_tier_id
    return rule


class YieldEngineNoRuleFires(TestCase):
    """Scenario 1 — No rule fires: base price returned unchanged."""

    @patch.object(YieldEngine, '_load_rules', return_value=[])
    def test_no_rule_returns_base(self, mock_rules):
        marina = _make_marina()
        berth = _make_berth(pricing_tier_price='100.00')
        engine = YieldEngine(marina)

        check_in = date(2026, 7, 1)
        check_out = date(2026, 7, 5)  # 4 nights
        result = engine.compute(berth, check_in, check_out, 'transient')

        self.assertEqual(result['base_price'], Decimal('100.00'))
        self.assertEqual(result['effective_price'], Decimal('100.00'))
        self.assertEqual(result['total_amount'], Decimal('400.00'))
        self.assertIsNone(result['rule_applied'])
        self.assertFalse(result['floor_ceiling_clamped'])
        self.assertFalse(result['sniper_eligible'])


class YieldEngineTierScopeOccupancy(TestCase):
    """Scenario 2 — Occupancy threshold at tier scope fires correctly."""

    def test_tier_scope_fires_when_threshold_met(self):
        marina = _make_marina()
        berth = _make_berth()
        rule = _make_rule(
            trigger_type='occupancy_threshold',
            occupancy_scope='tier',
            occupancy_threshold_pct='70',
            booking_tier_id=42,
            action_type='percent_uplift',
            action_value='15',
        )

        with patch.object(YieldEngine, '_load_rules', return_value=[rule]), \
             patch.object(YieldEngine, '_check_occupancy', return_value=True):

            engine = YieldEngine(marina)
            check_in = date(2026, 8, 10)
            check_out = date(2026, 8, 12)
            result = engine.compute(berth, check_in, check_out, 'transient')

        # 100 * 1.15 = 115
        self.assertEqual(result['effective_price'], Decimal('100.00') * Decimal('1.15'))
        self.assertEqual(result['rule_applied'], 'Test Rule')
        self.assertFalse(result['sniper_eligible'])

    def test_tier_scope_does_not_fire_when_below_threshold(self):
        marina = _make_marina()
        berth = _make_berth()
        rule = _make_rule(
            trigger_type='occupancy_threshold',
            occupancy_scope='tier',
            occupancy_threshold_pct='90',
            booking_tier_id=42,
        )

        with patch.object(YieldEngine, '_load_rules', return_value=[rule]), \
             patch.object(YieldEngine, '_check_occupancy', return_value=False):

            engine = YieldEngine(marina)
            result = engine.compute(
                berth, date(2026, 8, 10), date(2026, 8, 11), 'transient'
            )

        self.assertIsNone(result['rule_applied'])
        self.assertEqual(result['effective_price'], result['base_price'])


class YieldEngineMarinaScopeOccupancy(TestCase):
    """Scenario 3 — Occupancy threshold at marina scope fires correctly."""

    def test_marina_scope_fires(self):
        marina = _make_marina()
        berth = _make_berth()
        rule = _make_rule(
            trigger_type='occupancy_threshold',
            occupancy_scope='marina',
            occupancy_threshold_pct='80',
            action_type='percent_uplift',
            action_value='25',
        )

        with patch.object(YieldEngine, '_load_rules', return_value=[rule]), \
             patch.object(YieldEngine, '_check_occupancy', return_value=True):

            engine = YieldEngine(marina)
            result = engine.compute(
                berth, date(2026, 7, 15), date(2026, 7, 16), 'transient'
            )

        self.assertEqual(result['effective_price'], Decimal('125.00'))
        self.assertEqual(result['rule_applied'], 'Test Rule')


class YieldEngineDaysToArrival(TestCase):
    """Scenario 4 — Days-to-arrival trigger fires when check-in is soon."""

    def test_fires_when_within_days(self):
        marina = _make_marina()
        berth = _make_berth()
        rule = _make_rule(
            trigger_type='days_to_arrival',
            days_to_arrival_lte=7,
            action_type='percent_discount',
            action_value='10',
        )

        check_in = date.today() + timedelta(days=3)  # 3 days away — within 7
        check_out = check_in + timedelta(days=2)

        with patch.object(YieldEngine, '_load_rules', return_value=[rule]):
            engine = YieldEngine(marina)
            result = engine.compute(berth, check_in, check_out, 'transient')

        # 100 * 0.90 = 90
        self.assertEqual(result['effective_price'], Decimal('90.00'))
        self.assertTrue(result['sniper_eligible'])

    def test_does_not_fire_when_outside_days(self):
        marina = _make_marina()
        berth = _make_berth()
        rule = _make_rule(
            trigger_type='days_to_arrival',
            days_to_arrival_lte=2,
            action_type='percent_discount',
            action_value='10',
        )

        check_in = date.today() + timedelta(days=10)  # 10 days away — outside 2
        check_out = check_in + timedelta(days=1)

        with patch.object(YieldEngine, '_load_rules', return_value=[rule]):
            engine = YieldEngine(marina)
            result = engine.compute(berth, check_in, check_out, 'transient')

        self.assertIsNone(result['rule_applied'])
        self.assertFalse(result['sniper_eligible'])


class YieldEngineGapFill(TestCase):
    """Scenario 5 — Gap-fill trigger fires when adjacent booking exists."""

    def test_fires_with_adjacent_booking(self):
        marina = _make_marina()
        berth = _make_berth()
        rule = _make_rule(
            trigger_type='gap_fill',
            gap_max_nights=3,
            action_type='percent_discount',
            action_value='20',
        )

        check_in = date(2026, 9, 5)
        check_out = date(2026, 9, 7)

        with patch.object(YieldEngine, '_load_rules', return_value=[rule]), \
             patch.object(YieldEngine, '_check_gap_fill', return_value=True):

            engine = YieldEngine(marina)
            result = engine.compute(berth, check_in, check_out, 'transient')

        self.assertEqual(result['effective_price'], Decimal('80.00'))
        self.assertTrue(result['sniper_eligible'])

    def test_does_not_fire_without_adjacent_booking(self):
        marina = _make_marina()
        berth = _make_berth()
        rule = _make_rule(
            trigger_type='gap_fill',
            gap_max_nights=3,
        )

        check_in = date(2026, 9, 5)
        check_out = date(2026, 9, 7)

        with patch.object(YieldEngine, '_load_rules', return_value=[rule]), \
             patch.object(YieldEngine, '_check_gap_fill', return_value=False):

            engine = YieldEngine(marina)
            result = engine.compute(berth, check_in, check_out, 'transient')

        self.assertIsNone(result['rule_applied'])


class YieldEngineSeasonalGuard(TestCase):
    """Scenario 6 — Non-transient booking type: engine returns base immediately."""

    @patch.object(YieldEngine, '_load_rules')
    def test_seasonal_skips_engine(self, mock_load_rules):
        marina = _make_marina()
        berth = _make_berth(pricing_tier_price='200.00')
        engine = YieldEngine(marina)

        result = engine.compute(
            berth,
            date(2026, 1, 1),
            date(2026, 12, 31),
            booking_type='seasonal',
        )

        # _load_rules must NOT be called for non-transient bookings.
        mock_load_rules.assert_not_called()
        self.assertEqual(result['base_price'], Decimal('200.00'))
        self.assertEqual(result['effective_price'], Decimal('200.00'))
        self.assertIsNone(result['rule_applied'])
        self.assertFalse(result['sniper_eligible'])


class YieldEngineFloorClampNightly(TestCase):
    """Scenario 7 — Floor clamp on nightly pricing."""

    def test_floor_clamp_applied(self):
        marina = _make_marina()
        berth = _make_berth(pricing_tier_price='100.00')
        rule = _make_rule(
            trigger_type='days_to_arrival',
            days_to_arrival_lte=365,  # Always fires.
            action_type='percent_discount',
            action_value='50',     # Would bring to 50.
            floor_price='70',      # Floor is 70.
        )

        check_in = date.today() + timedelta(days=1)
        check_out = check_in + timedelta(days=1)

        with patch.object(YieldEngine, '_load_rules', return_value=[rule]):
            engine = YieldEngine(marina)
            result = engine.compute(berth, check_in, check_out, 'transient')

        self.assertEqual(result['effective_price'], Decimal('70'))
        self.assertTrue(result['floor_ceiling_clamped'])


class YieldEngineFloorClampHourly(TestCase):
    """Scenario 8 — Floor clamp on hourly pricing uses floor_price / 24."""

    def test_floor_clamp_hourly_divided_by_24(self):
        marina = _make_marina()
        berth = _make_berth(has_hourly_config=True, hourly_price='10.00')
        rule = _make_rule(
            trigger_type='days_to_arrival',
            days_to_arrival_lte=365,
            action_type='percent_discount',
            action_value='90',          # Would bring to 1.00/hr.
            floor_price='48',           # 48/night → 2.00/hr after /24.
            pricing_model_scope='per_hour',
        )

        check_in = date.today() + timedelta(days=1)
        check_out = check_in + timedelta(days=1)

        with patch.object(YieldEngine, '_load_rules', return_value=[rule]):
            engine = YieldEngine(marina)
            result = engine.compute(
                berth, check_in, check_out, 'transient',
                is_hourly=True, duration_minutes=120,
            )

        # Floor after conversion: 48 / 24 = 2.00
        self.assertEqual(result['effective_price'], Decimal('2.00'))
        self.assertTrue(result['floor_ceiling_clamped'])
        # total = 2.00 * (120/60) = 4.00
        self.assertEqual(result['total_amount'], Decimal('4.00'))


class YieldEngineCeilingClamp(TestCase):
    """Scenario 9 — Ceiling clamp prevents price from exceeding maximum."""

    def test_ceiling_clamp_applied(self):
        marina = _make_marina()
        berth = _make_berth(pricing_tier_price='100.00')
        rule = _make_rule(
            trigger_type='occupancy_threshold',
            occupancy_threshold_pct='50',
            action_type='percent_uplift',
            action_value='50',     # Would bring to 150.
            ceiling_price='120',   # Ceiling is 120.
        )

        with patch.object(YieldEngine, '_load_rules', return_value=[rule]), \
             patch.object(YieldEngine, '_check_occupancy', return_value=True):

            engine = YieldEngine(marina)
            result = engine.compute(
                berth, date(2026, 6, 1), date(2026, 6, 3), 'transient'
            )

        self.assertEqual(result['effective_price'], Decimal('120'))
        self.assertTrue(result['floor_ceiling_clamped'])

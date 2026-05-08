"""
YieldEngine — dynamic pricing engine for transient berth bookings.

Usage::

    engine = YieldEngine(marina)
    result = engine.compute(
        berth=berth,
        check_in=date(2026, 7, 1),
        check_out=date(2026, 7, 5),
        booking_type='transient',
        is_hourly=False,
    )

The returned dict has the shape::

    {
        'base_price':           Decimal,   # per-night or per-hour unit price
        'effective_price':      Decimal,   # unit price after rule, clamped to floor/ceiling
        'total_amount':         Decimal,   # effective_price * nights (or hours)
        'rule_applied':         str | None,
        'floor_ceiling_clamped': bool,
        'sniper_eligible':      bool,
    }
"""

from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal

from django.db.models import Q

logger = logging.getLogger(__name__)


class YieldEngine:
    def __init__(self, marina):
        self.marina = marina

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def compute(
        self,
        berth,
        check_in: date,
        check_out: date,
        booking_type: str,
        is_hourly: bool = False,
        duration_minutes: int | None = None,
    ) -> dict:
        """Compute the effective price for the given berth / date range.

        Returns a dict with keys: base_price, effective_price, total_amount,
        rule_applied, floor_ceiling_clamped, sniper_eligible.
        """

        # Hard guard: yield management only applies to transient bookings.
        if booking_type != 'transient':
            base = self._base_price(berth, is_hourly)
            nights = (check_out - check_in).days or 1
            duration = duration_minutes or 60
            units = (duration / 60) if is_hourly else nights
            return {
                'base_price': base,
                'effective_price': base,
                'total_amount': base * Decimal(str(units)),
                'rule_applied': None,
                'floor_ceiling_clamped': False,
                'sniper_eligible': False,
            }

        base_price = self._base_price(berth, is_hourly)
        today = date.today()
        nights = (check_out - check_in).days or 1
        duration = duration_minutes or 60
        units = Decimal(str((duration / 60) if is_hourly else nights))

        # Load active rules ordered by priority (ascending = highest priority first).
        rules = self._load_rules(berth, is_hourly)

        effective_price = base_price
        rule_applied = None
        floor_ceiling_clamped = False
        sniper_eligible = False

        for rule in rules:
            if not self._rule_in_window(rule, check_in):
                continue
            if self._trigger_fires(rule, berth, check_in, today):
                effective_price = self._apply_action(rule, base_price)
                rule_applied = rule.name

                # Sniper eligibility: gap-fill or last-minute discounts.
                if rule.trigger_type in ('gap_fill', 'days_to_arrival'):
                    sniper_eligible = True

                # Floor / ceiling clamping.
                effective_price, floor_ceiling_clamped = self._clamp(
                    rule, effective_price, is_hourly
                )
                break  # First match wins; no stacking.

        total_amount = effective_price * units

        return {
            'base_price': base_price,
            'effective_price': effective_price,
            'total_amount': total_amount,
            'rule_applied': rule_applied,
            'floor_ceiling_clamped': floor_ceiling_clamped,
            'sniper_eligible': sniper_eligible,
        }

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _base_price(self, berth, is_hourly: bool) -> Decimal:
        """Return the relevant base unit price for the berth."""
        if is_hourly:
            try:
                return Decimal(str(berth.hourly_config.pricing_item.unit_price))
            except Exception:
                return Decimal('0.00')

        # Nightly: start from berth.pricing_tier, then apply booking_tier premium.
        try:
            unit_price = Decimal(str(berth.pricing_tier.unit_price))
        except Exception:
            return Decimal('0.00')

        # If the berth belongs to a BookingTier, apply the premium.
        try:
            premium_pct = Decimal(str(berth.booking_tier.rate_premium_pct))
            unit_price = unit_price * (1 + premium_pct / 100)
        except Exception:
            pass  # No booking_tier on berth — use raw price.

        return unit_price

    def _load_rules(self, berth, is_hourly: bool):
        """Return active YieldRules for this marina, filtered to pricing model scope."""
        from apps.revenue_intelligence.models import YieldRule

        pricing_scope_filter = Q(pricing_model_scope='all')
        if is_hourly:
            pricing_scope_filter |= Q(pricing_model_scope='per_hour')
        else:
            pricing_scope_filter |= Q(pricing_model_scope='per_night')

        return (
            YieldRule.objects.filter(marina=self.marina, is_active=True)
            .filter(pricing_scope_filter)
            .order_by('priority', 'name')
            .select_related('booking_tier')
        )

    def _rule_in_window(self, rule, check_in: date) -> bool:
        """Return True if the rule is valid for the given check-in date."""
        if rule.valid_from and check_in < rule.valid_from:
            return False
        if rule.valid_until and check_in > rule.valid_until:
            return False
        return True

    def _trigger_fires(self, rule, berth, check_in: date, today: date) -> bool:
        """Evaluate whether a given rule's trigger condition is met."""
        trigger = rule.trigger_type

        if trigger == 'occupancy_threshold':
            return self._check_occupancy(rule, berth, check_in)

        if trigger == 'days_to_arrival':
            if rule.days_to_arrival_lte is None:
                return False
            days_away = (check_in - today).days
            return days_away <= rule.days_to_arrival_lte

        if trigger == 'days_in_advance':
            if rule.days_in_advance_gte is None:
                return False
            days_away = (check_in - today).days
            return days_away >= rule.days_in_advance_gte

        if trigger == 'gap_fill':
            return self._check_gap_fill(rule, berth, check_in)

        return False

    def _check_occupancy(self, rule, berth, check_in: date) -> bool:
        """Check whether occupancy for the relevant scope meets the threshold."""
        from apps.reservations.models import Booking

        if rule.occupancy_threshold_pct is None:
            return False

        active_statuses = ['confirmed', 'checked_in', 'pending', 'pending_approval',
                           'awaiting_payment', 'pending_payment']

        if rule.occupancy_scope == 'tier' and rule.booking_tier_id:
            # Count berths in this tier that are booked around check_in.
            from apps.berths.models import Berth
            tier_berths = Berth.objects.filter(
                marina=self.marina,
                booking_tier_id=rule.booking_tier_id,
            )
            total = tier_berths.count()
            if total == 0:
                return False
            occupied = Booking.objects.filter(
                marina=self.marina,
                berth__in=tier_berths,
                check_in__lte=check_in,
                check_out__gt=check_in,
                status__in=active_statuses,
            ).count()
        else:
            # Marina-wide scope.
            from apps.berths.models import Berth
            total = Berth.objects.filter(marina=self.marina).count()
            if total == 0:
                return False
            occupied = Booking.objects.filter(
                marina=self.marina,
                check_in__lte=check_in,
                check_out__gt=check_in,
                status__in=active_statuses,
            ).count()

        pct = Decimal(str(occupied)) / Decimal(str(total)) * 100
        return pct >= rule.occupancy_threshold_pct

    def _check_gap_fill(self, rule, berth, check_in: date) -> bool:
        """Return True if there is a qualifying gap adjacent to this berth + check_in."""
        if rule.gap_max_nights is None:
            return False

        from apps.reservations.models import Booking
        from datetime import timedelta

        # Look for a booking that ends just before check_in (gap <= gap_max_nights).
        gap_window_start = check_in - timedelta(days=rule.gap_max_nights)
        adjacent = Booking.objects.filter(
            berth=berth,
            check_out__gte=gap_window_start,
            check_out__lte=check_in,
        ).exists()
        return adjacent

    def _apply_action(self, rule, base_price: Decimal) -> Decimal:
        """Apply the rule's action to the base price and return the new price."""
        action = rule.action_type
        value = Decimal(str(rule.action_value))

        if action == 'percent_uplift':
            return base_price * (1 + value / 100)
        if action == 'percent_discount':
            return base_price * (1 - value / 100)
        if action == 'fixed_uplift':
            return base_price + value
        if action == 'fixed_discount':
            return max(Decimal('0.00'), base_price - value)

        return base_price

    def _clamp(
        self, rule, price: Decimal, is_hourly: bool
    ) -> tuple[Decimal, bool]:
        """Clamp price to floor/ceiling. Returns (clamped_price, was_clamped)."""
        clamped = False

        floor = rule.floor_price
        ceiling = rule.ceiling_price

        # For hourly bookings, floor/ceiling are stored as per-night equivalents;
        # convert to per-hour by dividing by 24.
        if is_hourly and floor is not None:
            floor = Decimal(str(floor)) / 24
        if is_hourly and ceiling is not None:
            ceiling = Decimal(str(ceiling)) / 24

        if floor is not None and price < Decimal(str(floor)):
            price = Decimal(str(floor))
            clamped = True

        if ceiling is not None and price > Decimal(str(ceiling)):
            price = Decimal(str(ceiling))
            clamped = True

        return price, clamped

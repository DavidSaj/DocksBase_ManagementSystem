"""
tests/test_zone_engine.py

Tests for apps/access_control/services/zone_engine.member_can_access_zone()
"""

from datetime import date
from unittest.mock import MagicMock, patch

import pytest


@pytest.mark.django_db
class TestMemberCanAccessZone:

    def _make_marina(self):
        from apps.accounts.models import Marina
        return Marina.objects.create(name='Test Marina', slug='test-marina', features={})

    def _make_zone(self, marina, name='Pier A'):
        from apps.access_control.models import AccessZone
        return AccessZone.objects.create(marina=marina, name=name)

    def _make_member(self, marina, member_type='seasonal'):
        from apps.members.models import Member
        return Member.objects.create(marina=marina, name='Test Member', member_type=member_type)

    def _make_rule(self, marina, member_type='seasonal', link_to_berth_pier=False):
        from apps.access_control.models import ZoneAccessRule
        return ZoneAccessRule.objects.create(
            marina=marina,
            member_type=member_type,
            link_to_berth_pier=link_to_berth_pier,
        )

    def test_no_rule_denies(self):
        from apps.access_control.services.zone_engine import member_can_access_zone
        marina = self._make_marina()
        zone   = self._make_zone(marina)
        member = self._make_member(marina)
        assert member_can_access_zone(member, zone) is False

    def test_flat_zone_rule_allows_member_type(self):
        from apps.access_control.services.zone_engine import member_can_access_zone
        marina = self._make_marina()
        zone   = self._make_zone(marina)
        member = self._make_member(marina, 'seasonal')
        rule   = self._make_rule(marina, 'seasonal')
        rule.zones.add(zone)
        assert member_can_access_zone(member, zone) is True

    def test_flat_zone_rule_denies_wrong_zone(self):
        from apps.access_control.services.zone_engine import member_can_access_zone
        marina = self._make_marina()
        zone_a = self._make_zone(marina, 'Pier A')
        zone_b = self._make_zone(marina, 'Pier B')
        member = self._make_member(marina, 'seasonal')
        rule   = self._make_rule(marina, 'seasonal')
        rule.zones.add(zone_a)
        assert member_can_access_zone(member, zone_b) is False

    def test_link_to_berth_pier_allows_correct_pier(self):
        from apps.access_control.services.zone_engine import member_can_access_zone
        from apps.reservations.models import Booking
        from apps.berths.models import Berth, Pier
        from apps.vessels.models import Vessel
        marina = self._make_marina()
        zone   = self._make_zone(marina, 'Pier A')
        member = self._make_member(marina, 'seasonal')
        rule   = self._make_rule(marina, 'seasonal', link_to_berth_pier=True)

        pier   = Pier.objects.create(marina=marina, code='A')
        berth  = Berth.objects.create(marina=marina, pier=pier, code='A1', pier_label='Pier A')
        vessel = Vessel.objects.create(marina=marina, name='Test Boat', owner=member)

        today = date.today()
        Booking.objects.create(
            marina=marina, vessel=vessel, berth=berth,
            status='confirmed', check_in=today, check_out=today,
        )

        assert member_can_access_zone(member, zone, as_of=today) is True

    def test_link_to_berth_pier_denies_wrong_pier(self):
        from apps.access_control.services.zone_engine import member_can_access_zone
        from apps.reservations.models import Booking
        from apps.berths.models import Berth, Pier
        from apps.vessels.models import Vessel
        marina  = self._make_marina()
        zone_b  = self._make_zone(marina, 'Pier B')
        member  = self._make_member(marina, 'seasonal')
        rule    = self._make_rule(marina, 'seasonal', link_to_berth_pier=True)

        pier   = Pier.objects.create(marina=marina, code='A')
        berth  = Berth.objects.create(marina=marina, pier=pier, code='A1', pier_label='Pier A')
        vessel = Vessel.objects.create(marina=marina, name='Test Boat', owner=member)
        today  = date.today()
        Booking.objects.create(
            marina=marina, vessel=vessel, berth=berth,
            status='confirmed', check_in=today, check_out=today,
        )

        # Zone B — member's berth is on Pier A, not Pier B
        assert member_can_access_zone(member, zone_b, as_of=today) is False

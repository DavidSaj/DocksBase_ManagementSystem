"""
tests/test_card_lifecycle.py

Card lifecycle and unique-active-card constraint tests.
"""

import pytest
from datetime import date, timedelta


@pytest.mark.django_db
class TestCardLifecycle:

    def _setup(self):
        from apps.accounts.models import Marina
        from apps.members.models import Member
        marina = Marina.objects.create(name='Marina', slug='m', features={})
        member = Member.objects.create(marina=marina, name='Alice', member_type='seasonal')
        return marina, member

    def _make_card(self, marina, member, card_uid='AABBCCDD', is_active=True):
        from apps.access_control.models import AccessCard
        return AccessCard.objects.create(
            marina=marina, member=member, card_uid=card_uid, is_active=is_active,
        )

    def test_unique_active_card_uid_per_marina_constraint(self):
        from django.db import IntegrityError
        from apps.access_control.models import AccessCard
        marina, member = self._setup()
        self._make_card(marina, member, 'AABBCCDD', is_active=True)
        with pytest.raises(IntegrityError):
            AccessCard.objects.create(
                marina=marina, member=member, card_uid='AABBCCDD', is_active=True,
            )

    def test_two_inactive_cards_same_uid_allowed(self):
        from apps.access_control.models import AccessCard
        marina, member = self._setup()
        AccessCard.objects.create(marina=marina, member=member, card_uid='AABBCCDD', is_active=False)
        # Second inactive card with same UID should be allowed (historical audit trail)
        AccessCard.objects.create(marina=marina, member=member, card_uid='AABBCCDD', is_active=False)

    def test_deactivate_expired_cards_task(self):
        from apps.access_control.models import AccessCard
        from apps.access_control.services.card_lifecycle import deactivate_expired_cards_for_marina
        marina, member = self._setup()
        yesterday = date.today() - timedelta(days=1)
        card = AccessCard.objects.create(
            marina=marina, member=member, card_uid='EXPIRED01',
            is_active=True, valid_to=yesterday,
        )
        count = deactivate_expired_cards_for_marina(marina)
        assert count == 1
        card.refresh_from_db()
        assert not card.is_active
        assert card.deactivation_reason == 'Expired (valid_to date passed)'

    def test_card_reissue_preserves_access_event_history(self):
        """
        Deactivating a card and creating a new one (card recycling) does NOT delete
        the AccessEvent rows from the old card — they point to the old card PK.
        """
        from apps.access_control.models import AccessCard, AccessEvent, AccessZone
        marina, member = self._setup()
        old_card = self._make_card(marina, member, 'RECYCLE01', is_active=True)
        zone = AccessZone.objects.create(marina=marina, name='Pier A')
        from django.utils import timezone
        AccessEvent.objects.create(
            marina=marina, credential_type='card', card=old_card, member=member,
            granted=True, occurred_at=timezone.now(),
        )
        # Deactivate old card
        from apps.access_control.services.card_lifecycle import deactivate_card
        deactivate_card(old_card, reason='Card lost — reissued')

        # Create new card (same physical UID — new PK)
        new_card = AccessCard.objects.create(
            marina=marina, member=member, card_uid='RECYCLE01', is_active=True,
        )

        # Old event still references old_card PK
        event = AccessEvent.objects.get(card=old_card)
        assert event.member == member
        assert event.card_id == old_card.pk
        assert new_card.pk != old_card.pk

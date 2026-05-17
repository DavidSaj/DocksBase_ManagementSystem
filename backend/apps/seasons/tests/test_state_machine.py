"""State-machine + signal tests (spec §4.3, locked decisions §9.2 & §9.11)."""
from datetime import date

import pytest

from apps.seasons import services
from apps.seasons.signals import lease_access_revoked, lease_status_changed


@pytest.mark.django_db
def test_happy_path_transitions(make_lease):
    lease = make_lease()
    assert lease.status == 'offered'

    services.transition_lease(lease, 'accepted')
    assert lease.status == 'accepted'

    services.transition_lease(lease, 'deposit_paid')
    assert lease.status == 'deposit_paid'
    assert lease.deposit_paid_at is not None
    # Instalment schedule generated.
    assert lease.instalments.count() == 6

    services.transition_lease(lease, 'active')
    assert lease.status == 'active'

    services.transition_lease(lease, 'ending')
    services.transition_lease(lease, 'ended')
    assert lease.status == 'ended'


@pytest.mark.django_db
def test_illegal_transition_raises(make_lease):
    lease = make_lease()
    with pytest.raises(services.InvalidLeaseTransition):
        services.transition_lease(lease, 'active')  # need deposit first


@pytest.mark.django_db(transaction=True)
def test_default_forfeits_deposit_and_fires_access_signal(make_lease):
    lease = make_lease()
    services.transition_lease(lease, 'accepted')
    services.transition_lease(lease, 'deposit_paid')

    fired = []

    def listener(sender, lease, reason, **kw):
        fired.append((lease.pk, reason))

    lease_access_revoked.connect(listener)
    try:
        services.transition_lease(lease, 'defaulted')
    finally:
        lease_access_revoked.disconnect(listener)

    lease.refresh_from_db()
    assert lease.status == 'defaulted'
    assert lease.deposit_forfeited is True
    # Signal fired with lease pk + previous status as reason.
    assert fired == [(lease.pk, 'deposit_paid')]


@pytest.mark.django_db(transaction=True)
def test_cancelled_transition_fires_access_signal(make_lease):
    lease = make_lease()
    fired = []

    def _listen(sender, lease, reason, **kw):
        fired.append(reason)

    lease_access_revoked.connect(_listen)
    try:
        services.transition_lease(lease, 'cancelled')
    finally:
        lease_access_revoked.disconnect(_listen)
    assert fired == ['offered']


@pytest.mark.django_db(transaction=True)
def test_status_change_signal_fires_on_every_transition(make_lease):
    lease = make_lease()
    events = []

    def _listen(sender, lease, old_status, new_status, **kw):
        events.append((old_status, new_status))

    lease_status_changed.connect(_listen)
    try:
        services.transition_lease(lease, 'accepted')
        services.transition_lease(lease, 'deposit_paid')
    finally:
        lease_status_changed.disconnect(_listen)
    assert events == [('offered', 'accepted'), ('accepted', 'deposit_paid')]

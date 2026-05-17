"""
apps/seasons/signals.py — internal Signal definitions.

``lease_access_revoked`` — spec §9.11.  Fires on every transition into
``defaulted`` or ``cancelled``.  The access_control app (or any plug-in
gate/ANPR integration) listens to this and deactivates physical key fobs.

The signal is sent inside ``transaction.on_commit`` so that a rolled-back
state change cannot accidentally revoke fobs.
"""
import django.dispatch


# Sent when a BerthLease moves to a status that should immediately revoke
# physical access (defaulted / cancelled).  Receivers get ``lease=...`` and
# ``reason=<previous_status>``.
lease_access_revoked = django.dispatch.Signal()

# Sent at every status transition.  Useful for analytics / notifications.
lease_status_changed = django.dispatch.Signal()

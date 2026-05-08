"""
ForkliftDeviceTokenAuthentication — lives in boatyard app.

Also accessible from apps.utilities.authentication (re-exported there for
convenience). The canonical source is here since ForkliftDeviceToken is a
boatyard model.

See apps/utilities/authentication.py for full documentation.
"""

# Re-export from utilities for convenience — single implementation.
from apps.utilities.authentication import ForkliftDeviceTokenAuthentication  # noqa: F401

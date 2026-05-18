"""Marina feature-flag helpers.

The Marina.features JSONField stores explicit user toggles from the admin portal.
A missing key falls back to a default determined by FEATURE_DEFAULT_OFF: any key
listed there defaults to False; everything else defaults to True.

Keep FEATURE_DEFAULT_OFF in sync with:
  - frontend/src/components/layout/Sidebar.jsx
  - admin/src/screens/MarinaDetail.jsx
  - shared/portal-ui/src/features.js
"""

FEATURE_DEFAULT_OFF = {
    'utilities', 'charter', 'restaurant', 'events', 'fuel_dock',
    'revenue_intelligence', 'loyalty', 'tenants', 'access_control', 'esg_enabled',
    'mod_berth_sale', 'revenue_share',
    'waiting_list',
    'booking_auto_tetris', 'guest_booking', 'booking_search', 'document_gate',
    'seasonal_approval', 'booking_cancellation',
    'esign', 'digital_wallet',
}


def is_feature_enabled(marina, key):
    """Return True if `marina.features[key]` is on, with sensible defaults."""
    if marina is None:
        return key not in FEATURE_DEFAULT_OFF
    features = getattr(marina, 'features', None) or {}
    value = features.get(key)
    if value is True:
        return True
    if value is False:
        return False
    return key not in FEATURE_DEFAULT_OFF

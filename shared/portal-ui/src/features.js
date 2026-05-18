// Feature keys that default to OFF (opt-in add-ons). Everything else defaults to ON.
// Keep in sync with frontend/src/components/layout/Sidebar.jsx
// and admin/src/screens/MarinaDetail.jsx.
export const FEATURE_DEFAULT_OFF = new Set([
  'utilities', 'charter', 'restaurant', 'events', 'fuel_dock',
  'revenue_intelligence', 'loyalty', 'tenants', 'access_control', 'esg_enabled',
  'mod_berth_sale', 'revenue_share',
  'waiting_list',
  'booking_auto_tetris', 'guest_booking', 'booking_search', 'document_gate',
  'seasonal_approval', 'booking_cancellation',
  'esign', 'digital_wallet',
]);

export function isFeatureEnabled(features, key) {
  const v = features?.[key];
  if (v === true) return true;
  if (v === false) return false;
  return !FEATURE_DEFAULT_OFF.has(key);
}

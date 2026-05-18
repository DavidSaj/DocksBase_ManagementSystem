import { createContext, useContext, useMemo } from 'react';

const UserContext = createContext(null);

function parseTokenPayload(token) {
  try {
    // Django signing format: base64(payload):timestamp:signature
    const segment = token.split(':')[0];
    return JSON.parse(atob(segment));
  } catch {
    return null;
  }
}

function buildCapabilities(tokenType, payload) {
  if (!payload) return {};
  if (tokenType === 'member') {
    return {
      isGuest:                false,
      isMember:               true,
      canViewBookingCheckin:  false,
      canViewFullLedger:      true,
      canViewLoyalty:         true,
      canBookServices:        true,
      canManageVessel:        true,
      canAccessGates:         true,
      canViewMarketplace:     true,
      canSublet:              false, // coming soon
    };
  }
  // guest token
  return {
    isGuest:                true,
    isMember:               false,
    canViewBookingCheckin:  true,
    canViewFullLedger:      false,
    canViewLoyalty:         false,
    canBookServices:        false,
    canManageVessel:        false,
    canAccessGates:         false,
    canViewMarketplace:     false,
    canSublet:              false,
  };
}

export function UserContextProvider({ children }) {
  const value = useMemo(() => {
    const sessionToken = localStorage.getItem('portal_session_token');
    const tokenType    = localStorage.getItem('portal_token_type'); // 'guest' | 'member'
    const marinaSlug   = localStorage.getItem('portal_marina_slug');

    if (!sessionToken) {
      return { user: null, capabilities: {}, marinaSlug };
    }

    const payload = parseTokenPayload(sessionToken);
    const capabilities = buildCapabilities(tokenType, payload);

    const user = tokenType === 'member'
      ? { type: 'member', memberId: payload?.member_id, email: payload?.email }
      : { type: 'guest',  bookingId: payload?.booking_id, email: payload?.boater_email };

    return { user, capabilities, marinaSlug };
  }, []); // recalculated only on mount; call refreshUserContext() after login

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUserContext() {
  return useContext(UserContext);
}

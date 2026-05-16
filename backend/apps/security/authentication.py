"""
MFA-gated JWT authentication class.

Behavioural rename of JWTAuthentication. The MFA gate happens at login time
(the token endpoint), not on every authenticated request. This class exists so
that a future refactor can add per-request MFA checks here without touching
any other code.
"""

from rest_framework_simplejwt.authentication import JWTAuthentication


class MFAGatedJWTAuthentication(JWTAuthentication):
    """
    Same as JWTAuthentication. The MFA gate happens at login time, not on
    every request. Renamed for clarity in the DEFAULT_AUTHENTICATION_CLASSES
    list so it's obvious that MFA is part of the authentication pipeline.

    Gracefully returns None for tokens that are clearly not JWTs (e.g. API
    keys starting with 'db_live_') so that subsequent authentication classes
    (APIKeyAuthentication) get a chance to handle them.
    """

    def authenticate(self, request):
        header = self.get_header(request)
        if header is not None:
            raw_token = self.get_raw_token(header)
            if raw_token is not None:
                raw_str = raw_token.decode('utf-8') if isinstance(raw_token, bytes) else raw_token
                # API keys start with 'db_live_' — not our scheme; let APIKeyAuthentication handle
                if raw_str.startswith('db_live_'):
                    return None
        return super().authenticate(request)

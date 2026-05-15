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
    """

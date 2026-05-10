from django.core import signing

MEMBER_MAGIC_SALT   = 'portal-member-magic-v1'
MEMBER_SESSION_SALT = 'portal-member-v1'
MEMBER_REFRESH_SALT = 'portal-refresh-v1'

MEMBER_MAGIC_MAX_AGE   = 60 * 60 * 24        # 24 hours to click the link
MEMBER_SESSION_MAX_AGE = 60 * 60             # 1 hour session token
MEMBER_REFRESH_MAX_AGE = 60 * 60 * 24 * 90  # 90 days rolling refresh


def make_member_magic_token(member_id, email):
    return signing.dumps(
        {'member_id': member_id, 'email': email},
        salt=MEMBER_MAGIC_SALT,
    )


def decode_member_magic_token(token):
    return signing.loads(token, salt=MEMBER_MAGIC_SALT, max_age=MEMBER_MAGIC_MAX_AGE)


def make_member_session_token(member_id, marina_slug, email):
    return signing.dumps(
        {'member_id': member_id, 'marina_slug': marina_slug, 'email': email, 'type': 'member'},
        salt=MEMBER_SESSION_SALT,
    )


def decode_member_session_token(token):
    return signing.loads(token, salt=MEMBER_SESSION_SALT, max_age=MEMBER_SESSION_MAX_AGE)


def make_refresh_token(member_id, marina_slug, email):
    return signing.dumps(
        {'member_id': member_id, 'marina_slug': marina_slug, 'email': email},
        salt=MEMBER_REFRESH_SALT,
    )


def decode_refresh_token(token):
    return signing.loads(token, salt=MEMBER_REFRESH_SALT, max_age=MEMBER_REFRESH_MAX_AGE)

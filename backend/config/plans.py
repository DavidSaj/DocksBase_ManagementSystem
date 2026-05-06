import os

PLAN_PRICE_IDS = {
    'starter':      os.environ.get('STRIPE_PRICE_STARTER', ''),
    'professional': os.environ.get('STRIPE_PRICE_PROFESSIONAL', ''),
    'enterprise':   os.environ.get('STRIPE_PRICE_ENTERPRISE', ''),
}

# Reverse lookup: price_id → plan key
PRICE_ID_TO_PLAN = {v: k for k, v in PLAN_PRICE_IDS.items() if v}

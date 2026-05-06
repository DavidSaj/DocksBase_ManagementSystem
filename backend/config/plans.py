import os

PLAN_PRICE_IDS = {
    'starter':      os.environ.get('STRIPE_PRICE_STARTER', ''),
    'professional': os.environ.get('STRIPE_PRICE_PROFESSIONAL', ''),
    'enterprise':   os.environ.get('STRIPE_PRICE_ENTERPRISE', ''),
}

# Reverse lookup: price_id → plan key
PRICE_ID_TO_PLAN = {v: k for k, v in PLAN_PRICE_IDS.items() if v}

# Enterprise multi-marina addon: charged per additional marina above the first
ENTERPRISE_ADDON_MARINA_PRICE_ID = os.environ.get('STRIPE_PRICE_ENTERPRISE_ADDON_MARINA', '')

PLAN_MONTHLY_PRICES = {
    'starter':      149,
    'professional': 349,
    'enterprise':   899,
}

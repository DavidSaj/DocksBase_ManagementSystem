"""
Allowed ISO 3166-1 alpha-2 country codes for billing_country / vessel_flag.

Initial set: EU 27 + EFTA + UK + US + CA + AU + NZ + TR + MC + ME + RS.
Extend before launch as customer geography demands.
"""

ALLOWED_COUNTRIES = frozenset({
    # EU 27
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
    'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
    'SI', 'ES', 'SE',
    # EFTA + UK
    'IS', 'LI', 'NO', 'CH', 'GB',
    # English-speaking maritime markets
    'US', 'CA', 'AU', 'NZ',
    # Mediterranean + Balkans
    'TR', 'MC', 'ME', 'RS',
})

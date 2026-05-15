"""
Output-only serializers for AIS endpoints. The service layer already returns
plain dicts so we don't need DRF serializer machinery for round-tripping —
this module exists for clarity and to make any future schema changes easy
to grep.
"""

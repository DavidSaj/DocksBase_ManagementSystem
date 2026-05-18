"""
SmartBerthScorer — multi-dimensional berth ranking engine.

Dimensions (default weights sum to 100):
  SizeFitScorer    (w_size_fit,      default 40 pts)
  GapMinScorer     (w_gap_min,       default 25 pts)
  AmenityMatchScorer (w_amenity_match, default 20 pts)
  PierClusterScorer (w_pier_cluster,  default 15 pts)

Air draft is NEVER a hard exclusion — it produces an amber warning on the result dict.
"""

import datetime
from decimal import Decimal

from django.db.models import Q

from .models import Berth, BerthScoreWeights, TemporaryDeparture

AIR_DRAFT_WARNING_TEXT = (
    'Vessel air draft exceeds standard clearance. '
    'Transit at low water only — confirm with harbour master.'
)

ACTIVE_BOOKING_STATUSES = ('awaiting_payment', 'confirmed', 'checked_in', 'pending_payment')


class SizeFitScorer:
    """
    Hard-excludes berths where the berth is physically smaller than the vessel.
    Air draft mismatch is a soft warning only.
    Score: weight × (1 - headroom_ratio), where headroom_ratio = (length - loa) / length.
    Smaller headroom → better fit → higher score.
    """

    def __init__(self, weight: int):
        self.weight = weight

    def hard_exclude(self, berth, loa, beam, draft) -> bool:
        """Return True if berth cannot physically fit the vessel (hard exclude)."""
        if loa and berth.length_m and berth.length_m < Decimal(str(loa)):
            return True
        if beam and berth.max_beam_m and berth.max_beam_m < Decimal(str(beam)):
            return True
        if draft and berth.max_draft_m and berth.max_draft_m < Decimal(str(draft)):
            return True
        return False

    def score(self, berth, loa) -> int:
        if not loa or not berth.length_m or berth.length_m == 0:
            return self.weight // 2  # neutral when no data
        headroom_ratio = float(berth.length_m - Decimal(str(loa))) / float(berth.length_m)
        headroom_ratio = max(0.0, min(1.0, headroom_ratio))
        return round(self.weight * (1 - headroom_ratio))

    def air_draft_warning(self, berth, air_draft) -> bool:
        if air_draft and berth.max_air_draft_m:
            return Decimal(str(air_draft)) > berth.max_air_draft_m
        return False


class GapMinScorer:
    """
    Refactored from apps/berths/allocator.py gap logic.
    Rewards berths where the new booking leaves minimal wasted gap on either side
    of existing confirmed bookings.

    Score: weight if zero gap wasted; 0 if the berth is wide open on both sides.
    """

    def __init__(self, weight: int):
        self.weight = weight

    def score(self, berth, check_in: datetime.date, check_out: datetime.date) -> int:
        from apps.reservations.models import Booking

        # Bookings on this berth that are entirely before or after the requested window
        before = (
            Booking.objects.filter(
                berth=berth,
                status__in=ACTIVE_BOOKING_STATUSES,
                check_out__lte=check_in,
            )
            .order_by('-check_out')
            .first()
        )
        after = (
            Booking.objects.filter(
                berth=berth,
                status__in=ACTIVE_BOOKING_STATUSES,
                check_in__gte=check_out,
            )
            .order_by('check_in')
            .first()
        )

        gap_before = (check_in - before.check_out).days if before else None
        gap_after  = (after.check_in - check_out).days if after else None

        if gap_before is None and gap_after is None:
            # Completely empty berth — no gap minimisation signal
            return 0

        total_gap = 0
        if gap_before is not None:
            total_gap += gap_before
        if gap_after is not None:
            total_gap += gap_after

        # A gap of 0 on both sides = full score; large gap tapers off over 30+ days
        normalised = min(1.0, total_gap / 30.0)
        return round(self.weight * (1 - normalised))


class AmenityMatchScorer:
    """
    Scores amenity/mooring preference overlap between vessel requirements and berth.
    """

    def __init__(self, weight: int):
        self.weight = weight

    def score(self, berth, shore_power: bool, mooring_pref: str) -> int:
        requirements = 0
        matched = 0

        if shore_power:
            requirements += 1
            berth_amenities = berth.amenities or []
            if 'power_30a' in berth_amenities or 'power_50a' in berth_amenities:
                matched += 1

        if mooring_pref and berth.category:
            requirements += 1
            if berth.category.mooring_type == mooring_pref:
                matched += 1

        if requirements == 0:
            return self.weight // 2  # neutral — no preferences stated
        return round(self.weight * (matched / requirements))


class PierClusterScorer:
    """
    For fleet assignments: awards full points if the berth's LogicalPier already
    has another booking from the same booking_source + check_in group.
    For single-vessel scoring: always returns 0.
    """

    def __init__(self, weight: int):
        self.weight = weight

    def score(self, berth, booking_source: str, check_in: datetime.date) -> int:
        if not booking_source or not check_in:
            return 0

        from apps.reservations.models import Booking

        # Resolve the logical pier for this berth via its physical pier
        logical_pier = None
        if berth.pier and berth.pier.logical_pier_id:
            logical_pier = berth.pier.logical_pier_id

        if logical_pier is None:
            return 0

        # Check if any existing confirmed booking for this fleet is on the same logical pier
        fleet_on_pier = Booking.objects.filter(
            booking_source=booking_source,
            check_in=check_in,
            status__in=ACTIVE_BOOKING_STATUSES,
            berth__pier__logical_pier_id=logical_pier,
        ).exclude(berth__isnull=True).exists()

        return self.weight if fleet_on_pier else 0


class SmartBerthScorer:
    """
    Orchestrates all four dimension scorers with per-marina tunable weights.

    Usage:
        scorer = SmartBerthScorer(marina, check_in, check_out, vessel_params)
        results = scorer.score_all()   # sorted list, highest score first
    """

    def __init__(self, marina, check_in: datetime.date, check_out: datetime.date, vessel_params: dict):
        """
        vessel_params keys:
            loa         (Decimal or float, required for hard exclusion)
            beam        (Decimal or float, optional)
            draft       (Decimal or float, optional)
            air_draft   (Decimal or float, optional — soft warning only)
            shore_power (bool, optional)
            mooring_pref (str, optional — must match BerthCategory.MOORING_CHOICES value)
            booking_source (str, optional — for fleet pier-clustering)
        """
        self.marina = marina
        self.check_in = check_in
        self.check_out = check_out
        self.vessel_params = vessel_params

        weights = BerthScoreWeights.objects.get_or_create(marina=marina)[0]
        # Safety normalisation if weights drift from 100
        total = weights.w_size_fit + weights.w_gap_min + weights.w_amenity_match + weights.w_pier_cluster
        if total != 100:
            factor = 100 / total
            w_size_fit      = round(weights.w_size_fit * factor)
            w_gap_min       = round(weights.w_gap_min * factor)
            w_amenity_match = round(weights.w_amenity_match * factor)
            w_pier_cluster  = 100 - w_size_fit - w_gap_min - w_amenity_match
        else:
            w_size_fit      = weights.w_size_fit
            w_gap_min       = weights.w_gap_min
            w_amenity_match = weights.w_amenity_match
            w_pier_cluster  = weights.w_pier_cluster

        self.size_scorer    = SizeFitScorer(w_size_fit)
        self.gap_scorer     = GapMinScorer(w_gap_min)
        self.amenity_scorer = AmenityMatchScorer(w_amenity_match)
        self.pier_scorer    = PierClusterScorer(w_pier_cluster)

    def get_available_berths(self):
        """
        Returns berths physically available for the check_in → check_out window.

        Available means:
          1. No confirmed/checked_in booking overlapping the window, OR
          2. The berth has a TemporaryDeparture (sublet_enabled=True) that covers
             the requested window — this opens the berth to transient guests.

        Berths with conflicting hard bookings are always excluded.
        """
        from apps.reservations.models import Booking

        # Berths blocked by an active booking that overlaps our window
        conflicting_berth_ids = (
            Booking.objects.filter(
                marina=self.marina,
                status__in=ACTIVE_BOOKING_STATUSES,
                check_in__lt=self.check_out,
                check_out__gt=self.check_in,
            )
            .exclude(berth__isnull=True)
            .values_list('berth_id', flat=True)
        )

        # Base available pool: all standard berths not in maintenance, not conflicted
        base_qs = Berth.objects.filter(
            marina=self.marina,
            berth_class='standard',
        ).exclude(
            status='maintenance',
        ).exclude(
            id__in=conflicting_berth_ids,
        ).select_related('pier__logical_pier', 'category', 'pricing_tier')

        # Phase 3: drop berths held by an active seasonal lease, except those
        # whose holder has opened a sublet window covering our dates. Shared
        # filter so scorer + legacy allocator cannot drift. Spec §4.2.
        from .availability import berth_lease_inventory_filter
        base_qs = berth_lease_inventory_filter(base_qs, self.check_in, self.check_out)

        # Also include berths that are normally occupied by a seasonal holder
        # but have a TemporaryDeparture with sublet_enabled covering our window.
        sublet_berth_ids = (
            TemporaryDeparture.objects.filter(
                marina=self.marina,
                status__in=('scheduled', 'active'),
                sublet_enabled=True,
                depart_date__lte=self.check_in,
                expected_return__gte=self.check_out,
            )
            .values_list('berth_id', flat=True)
        )

        # Union: available base berths UNION sublet-open berths (minus conflicts)
        available_qs = base_qs | Berth.objects.filter(
            marina=self.marina,
            id__in=sublet_berth_ids,
        ).exclude(
            id__in=conflicting_berth_ids,
        ).select_related('pier__logical_pier', 'category', 'pricing_tier')

        return available_qs.distinct()

    def score_berth(self, berth) -> dict:
        """Score a single berth and return the full result dict."""
        vp = self.vessel_params
        loa          = vp.get('loa')
        beam         = vp.get('beam')
        draft        = vp.get('draft')
        air_draft    = vp.get('air_draft')
        shore_power  = bool(vp.get('shore_power', False))
        mooring_pref = vp.get('mooring_pref', '')
        booking_source = vp.get('booking_source', '')

        size_score    = self.size_scorer.score(berth, loa)
        gap_score     = self.gap_scorer.score(berth, self.check_in, self.check_out)
        amenity_score = self.amenity_scorer.score(berth, shore_power, mooring_pref)
        pier_score    = self.pier_scorer.score(berth, booking_source, self.check_in)
        total_score   = size_score + gap_score + amenity_score + pier_score

        air_draft_warning = self.size_scorer.air_draft_warning(berth, air_draft)

        # Pricing
        price_per_night = None
        pricing_tier_id = None
        if berth.pricing_tier:
            price_per_night = float(berth.pricing_tier.unit_price)
            pricing_tier_id = berth.pricing_tier_id

        return {
            'berth_id':      berth.pk,
            'berth_code':    berth.code,
            'pier':          berth.pier.code if berth.pier else None,
            'logical_pier':  (
                berth.pier.logical_pier.name
                if berth.pier and berth.pier.logical_pier
                else None
            ),
            'score':         total_score,
            'score_breakdown': {
                'size_fit':     size_score,
                'gap_min':      gap_score,
                'amenity_match': amenity_score,
                'pier_cluster': pier_score,
            },
            'length_m':          float(berth.length_m) if berth.length_m else None,
            'max_beam_m':        float(berth.max_beam_m) if berth.max_beam_m else None,
            'max_draft_m':       float(berth.max_draft_m) if berth.max_draft_m else None,
            'max_air_draft_m':   float(berth.max_air_draft_m) if berth.max_air_draft_m else None,
            'amenities':         berth.amenities or [],
            'pricing_tier_id':   pricing_tier_id,
            'price_per_night':   price_per_night,
            'air_draft_warning': air_draft_warning,
            'air_draft_warning_text': AIR_DRAFT_WARNING_TEXT if air_draft_warning else '',
        }

    def score_all(self) -> list:
        """
        Return all available berths ranked by score (highest first), after applying
        hard size-fit exclusions.
        """
        vp = self.vessel_params
        loa   = vp.get('loa')
        beam  = vp.get('beam')
        draft = vp.get('draft')

        results = []
        for berth in self.get_available_berths():
            if self.size_scorer.hard_exclude(berth, loa, beam, draft):
                continue
            results.append(self.score_berth(berth))

        results.sort(key=lambda r: r['score'], reverse=True)
        return results

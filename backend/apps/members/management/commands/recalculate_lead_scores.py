"""
Management command: recalculate_lead_scores

Computes a composite lead score for members who have never made a booking.
Score components (configurable via LEAD_SCORE_WEIGHTS in settings):
  - portal_login_30d:   30 pts  (member has a boater_user who logged in within 30 days)
  - email_opens_30d:    5 pts per open, capped at 50 pts
  - booking_widget_14d: 20 pts  (stub — integration with booking widget analytics TBD)
  - vessel_loa_match:   15 pts  (member has a vessel whose LOA fits the marina's
                                 longest berth; marinas with no berths contribute 0)

Usage:
    python manage.py recalculate_lead_scores [--marina-id=<id>]
"""
from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta


DEFAULT_WEIGHTS = {
    'portal_login_30d': 30,
    'email_open': 5,
    'email_opens_cap': 50,
    'booking_widget_14d': 20,
    'vessel_loa_match': 15,
}


class Command(BaseCommand):
    help = 'Recalculate lead scores for never-booked members.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--marina-id',
            type=int,
            default=None,
            help='Restrict to a single marina by ID.',
        )

    def handle(self, *args, **options):
        from django.conf import settings
        from apps.members.models import Member, LeadScore

        weights = getattr(settings, 'LEAD_SCORE_WEIGHTS', DEFAULT_WEIGHTS)
        now = timezone.now()
        thirty_days_ago = now - timedelta(days=30)
        fourteen_days_ago = now - timedelta(days=14)

        member_qs = Member.objects.filter(is_archived=False).select_related(
            'marina', 'boater_user',
        ).prefetch_related('vessels')

        if options['marina_id']:
            member_qs = member_qs.filter(marina_id=options['marina_id'])

        # Limit to never-booked members. `Booking` has no direct `member` FK
        # — it links to the boater via `vessel.owner`. `Reservation` does
        # carry a direct `member` FK. Union both so a member with a stay on
        # either model is correctly excluded from the never-booked cohort.
        from apps.reservations.models import Booking, Reservation
        booked_member_ids = set(
            Booking.objects
            .filter(vessel__owner__isnull=False)
            .values_list('vessel__owner_id', flat=True)
            .distinct()
        )
        booked_member_ids |= set(
            Reservation.objects
            .filter(member__isnull=False)
            .values_list('member_id', flat=True)
            .distinct()
        )

        updated = 0

        # Cache per-marina effective max LOA (= length of the marina's longest
        # berth). Computing this per-vessel would be N×M queries; here it's
        # one aggregate query per marina, computed lazily on first use.
        marina_max_loa_cache = {}

        def _effective_max_loa(marina):
            if marina.pk in marina_max_loa_cache:
                return marina_max_loa_cache[marina.pk]
            try:
                from django.db.models import Max
                value = marina.berths.aggregate(v=Max('length_m'))['v']
            except Exception:
                value = None
            marina_max_loa_cache[marina.pk] = value
            return value

        for member in member_qs:
            if member.pk in booked_member_ids:
                continue

            score = 0
            portal_login_30d = False
            email_opens_30d = 0
            booking_widget_14d = False
            vessel_loa_match = False

            # Portal login in last 30 days (via boater_user.last_login)
            if member.boater_user and member.boater_user.last_login:
                if member.boater_user.last_login >= thirty_days_ago:
                    portal_login_30d = True
                    score += weights.get('portal_login_30d', DEFAULT_WEIGHTS['portal_login_30d'])

            # Email opens (stub — requires email marketing integration)
            # email_opens_30d remains 0 until ESP webhook data is available
            open_score = min(
                email_opens_30d * weights.get('email_open', DEFAULT_WEIGHTS['email_open']),
                weights.get('email_opens_cap', DEFAULT_WEIGHTS['email_opens_cap']),
            )
            score += open_score

            # Booking widget (stub)
            if booking_widget_14d:
                score += weights.get('booking_widget_14d', DEFAULT_WEIGHTS['booking_widget_14d'])

            # Vessel LOA match — uses the marina's effective max LOA, derived
            # from the longest berth at that marina. If the marina has no
            # berths, the rule contributes 0.
            marina = member.marina
            effective_max_loa = _effective_max_loa(marina)
            if effective_max_loa:
                try:
                    if hasattr(member, 'vessels'):
                        # Vessel doesn't currently have an is_archived field;
                        # try the filtered form first, fall back to .all() if
                        # the field is missing on this schema.
                        try:
                            vessels = list(member.vessels.filter(is_archived=False))
                        except Exception:
                            vessels = list(member.vessels.all())
                    else:
                        vessels = []
                    for vessel in vessels:
                        if hasattr(vessel, 'loa') and vessel.loa and vessel.loa <= effective_max_loa:
                            vessel_loa_match = True
                            score += weights.get('vessel_loa_match', DEFAULT_WEIGHTS['vessel_loa_match'])
                            break
                except Exception:
                    pass

            LeadScore.objects.update_or_create(
                marina=member.marina,
                member=member,
                defaults={
                    'score': score,
                    'portal_login_30d': portal_login_30d,
                    'email_opens_30d': email_opens_30d,
                    'booking_widget_14d': booking_widget_14d,
                    'vessel_loa_match': vessel_loa_match,
                    'recalculated_at': now,
                },
            )
            updated += 1

        self.stdout.write(
            self.style.SUCCESS(f'Lead scores recalculated for {updated} member(s).')
        )

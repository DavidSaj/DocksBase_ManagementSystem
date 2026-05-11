"""
Management command: expire_points

Finds memberships with last_activity_at older than 730 days (2 years)
and expires their entire remaining points balance via a PointsLedger entry.

Usage:
    python manage.py expire_points [--dry-run]
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone


class Command(BaseCommand):
    help = 'Expire points for memberships with no activity in the last 730 days.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report how many memberships would be affected without making changes.',
        )

    def handle(self, *args, **options):
        from apps.loyalty.models import LoyaltyMembership, PointsLedger

        dry_run = options['dry_run']
        cutoff = timezone.now() - timedelta(days=730)

        expiry_candidates = LoyaltyMembership.objects.filter(
            points_balance__gt=0,
            last_activity_at__lt=cutoff,
        ).select_related('marina', 'member')

        count = expiry_candidates.count()

        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f'[DRY RUN] {count} membership(s) would have points expired.'
                )
            )
            return

        expired = 0
        for membership in expiry_candidates:
            points_to_expire = membership.points_balance
            if points_to_expire <= 0:
                continue

            from django.db import transaction
            from django.db.models import F

            with transaction.atomic():
                m = LoyaltyMembership.objects.select_for_update().get(pk=membership.pk)
                if m.points_balance <= 0:
                    continue
                expiring = m.points_balance
                m.points_balance = 0
                m.save(update_fields=['points_balance'])

                PointsLedger.objects.create(
                    membership=m,
                    entry_type=PointsLedger.EntryType.EXPIRE,
                    points=-expiring,
                    balance_after=0,
                    description=(
                        f'Points expired: no activity since '
                        f'{m.last_activity_at.date() if m.last_activity_at else "unknown"}'
                    ),
                )
                expired += 1

        self.stdout.write(
            self.style.SUCCESS(f'Expired points for {expired} membership(s).')
        )

"""
Celery tasks for Revenue Intelligence.

Beat schedule entries are configured in config/settings/base.py
(documented in INSTALL.md).

All task dispatches triggered from model signal / view code must use::

    transaction.on_commit(lambda: task.delay(...))
"""

from __future__ import annotations

import logging
from datetime import date

from celery import shared_task
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Waitlist Sniper
# ---------------------------------------------------------------------------

@shared_task(name='revenue_intelligence.run_waitlist_sniper')
def run_waitlist_sniper(
    berth_id: int,
    check_in: str,
    check_out: str,
    discounted_price: str,
    marina_id: int,
) -> dict:
    """
    Find waitlist entries that match the newly-available berth window and
    send them a WaitlistOffer with the given discounted price.

    Parameters are primitive types (JSON-serialisable) so they survive Celery
    serialisation.  Dates are ISO strings.
    """
    from apps.berths.models import Berth
    from apps.revenue_intelligence.models import WaitlistEntry, WaitlistOffer

    from decimal import Decimal
    from datetime import timedelta

    ci = date.fromisoformat(check_in)
    co = date.fromisoformat(check_out)
    price = Decimal(discounted_price)
    expires_at = timezone.now() + timedelta(hours=24)

    try:
        berth = Berth.objects.get(pk=berth_id)
    except Berth.DoesNotExist:
        logger.warning('run_waitlist_sniper: berth %s not found', berth_id)
        return {'offers_created': 0}

    entries = WaitlistEntry.objects.filter(
        marina_id=marina_id,
        is_active=True,
    ).filter(
        # Overlap: entry's desired window overlaps the available window.
        desired_check_in__lte=co,
        desired_check_out__gte=ci,
    )

    # Filter by vessel length if berth has a max length.
    if berth.length_m:
        entries = entries.filter(
            vessel_length_m__lte=berth.length_m
        )

    offers_created = 0
    for entry in entries:
        offer = WaitlistOffer.objects.create(
            marina_id=marina_id,
            waitlist_entry=entry,
            berth=berth,
            check_in=ci,
            check_out=co,
            discounted_price=price,
            status=WaitlistOffer.Status.PENDING,
            sent_at=timezone.now(),
            expires_at=expires_at,
        )
        # TODO: send email / push notification to entry.email
        logger.info('WaitlistOffer %s created for entry %s', offer.pk, entry.pk)
        offers_created += 1

    return {'offers_created': offers_created}


# ---------------------------------------------------------------------------
# Expire waitlist offers (periodic — every 5 minutes)
# ---------------------------------------------------------------------------

@shared_task(name='revenue_intelligence.expire_waitlist_offers')
def expire_waitlist_offers() -> dict:
    """Mark any PENDING WaitlistOffers whose expires_at has passed as EXPIRED."""
    from apps.revenue_intelligence.models import WaitlistOffer

    now = timezone.now()
    expired_count = WaitlistOffer.objects.filter(
        status=WaitlistOffer.Status.PENDING,
        expires_at__lt=now,
    ).update(status=WaitlistOffer.Status.EXPIRED)

    logger.info('expire_waitlist_offers: expired %d offers', expired_count)
    return {'expired': expired_count}


# ---------------------------------------------------------------------------
# Run upgrade campaigns (periodic — daily at 03:00)
# ---------------------------------------------------------------------------

@shared_task(bind=True, name='revenue_intelligence.run_upgrade_campaigns')
def run_upgrade_campaigns(self) -> dict:
    """
    For each marina, find confirmed bookings without an active upgrade campaign
    and create UpgradeCampaign rows where a better berth is available in the
    same date window.

    This is a broad scan — actual email sending is handled separately.
    """
    from apps.accounts.models import Marina
    from apps.berths.models import Berth
    from apps.reservations.models import Booking
    from apps.revenue_intelligence.models import UpgradeCampaign

    campaigns_created = 0

    for marina in Marina.objects.filter(operations_paused=False):
        confirmed_bookings = Booking.objects.filter(
            marina=marina,
            status='confirmed',
            check_in__gte=date.today(),
            booking_type='transient',
        ).select_related('berth', 'berth__booking_tier')

        for booking in confirmed_bookings:
            # Skip if already has a pending campaign.
            if UpgradeCampaign.objects.filter(
                booking=booking, status=UpgradeCampaign.Status.PENDING
            ).exists():
                continue

            berth = booking.berth
            if berth is None or berth.booking_tier is None:
                continue

            # Find a better berth (higher tier display_order) available in the window.
            from apps.revenue_intelligence.models import BookingTier
            try:
                current_tier = BookingTier.objects.get(
                    marina=marina, pk=berth.booking_tier_id
                )
            except BookingTier.DoesNotExist:
                continue

            better_tiers = BookingTier.objects.filter(
                marina=marina,
                display_order__gt=current_tier.display_order,
                is_active=True,
            ).order_by('display_order')

            for better_tier in better_tiers:
                # Find a berth in this tier not booked in the window.
                booked_berths = Booking.objects.filter(
                    marina=marina,
                    check_in__lt=booking.check_out,
                    check_out__gt=booking.check_in,
                    status__in=['confirmed', 'checked_in', 'pending_payment'],
                ).values_list('berth_id', flat=True)

                upgrade_berth = Berth.objects.filter(
                    marina=marina,
                    booking_tier=better_tier,
                ).exclude(pk__in=booked_berths).first()

                if upgrade_berth is None:
                    continue

                # Compute differential.
                from decimal import Decimal
                base = Decimal(str(berth.pricing_tier.unit_price)) if berth.pricing_tier else Decimal('0')
                upgrade = Decimal(str(upgrade_berth.pricing_tier.unit_price)) if upgrade_berth.pricing_tier else Decimal('0')
                diff = (upgrade - base) * booking.nights
                if diff <= 0:
                    continue

                UpgradeCampaign.objects.create(
                    marina=marina,
                    booking=booking,
                    from_tier=current_tier,
                    to_tier=better_tier,
                    offered_berth=upgrade_berth,
                    differential_amount=diff,
                    status=UpgradeCampaign.Status.PENDING,
                )
                campaigns_created += 1
                break  # One campaign per booking.

    logger.info('run_upgrade_campaigns: created %d campaigns', campaigns_created)
    return {'campaigns_created': campaigns_created}


# ---------------------------------------------------------------------------
# Scrape competitor rates (periodic — weekly Sunday at 06:00)
# ---------------------------------------------------------------------------

@shared_task(name='revenue_intelligence.scrape_competitor_rates')
def scrape_competitor_rates() -> dict:
    """Trigger the scraper for all CompetitorRate rows that have a competitor_url."""
    from apps.revenue_intelligence.models import CompetitorRate
    from apps.revenue_intelligence.scraper import CompetitorScraper

    rates = CompetitorRate.objects.filter(
        source=CompetitorRate.Source.SCRAPER,
        competitor_url__gt='',
    )

    scraped = 0
    errors = 0
    for rate in rates:
        scraper = CompetitorScraper(rate)
        try:
            scraper.fetch_and_update()
            scraped += 1
        except Exception as exc:
            logger.warning(
                'scrape_competitor_rates: failed for %s (%s)', rate.competitor_name, exc
            )
            errors += 1

    logger.info('scrape_competitor_rates: scraped=%d errors=%d', scraped, errors)
    return {'scraped': scraped, 'errors': errors}

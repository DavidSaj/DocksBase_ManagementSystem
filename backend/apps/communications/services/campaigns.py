from django.db import transaction
from django.utils import timezone


def send_campaign_batch(campaign_id, chunk_size=200):
    """
    Send an email campaign to its target segment.
    Uses select_for_update to prevent concurrent sends.
    """
    from apps.communications.models import EmailCampaign, EmailCampaignVariant
    from apps.communications.services.dispatch import dispatch
    from apps.members.models import Member

    with transaction.atomic():
        try:
            campaign = EmailCampaign.objects.select_for_update(nowait=True).get(
                pk=campaign_id,
                status__in=[EmailCampaign.Status.SCHEDULED, EmailCampaign.Status.DRAFT],
            )
        except EmailCampaign.DoesNotExist:
            return

        campaign.status = EmailCampaign.Status.SENDING
        campaign.save(update_fields=['status'])

    # Resolve audience
    if campaign.segment:
        filter_params = campaign.segment.filter_params or {}
        audience = Member.objects.filter(marina=campaign.marina, **filter_params)
    else:
        audience = Member.objects.filter(marina=campaign.marina)

    audience = audience.exclude(email='').values_list('id', 'email')

    # Get primary variant (or first variant)
    variant = EmailCampaignVariant.objects.filter(campaign=campaign).order_by('label').first()
    if not variant:
        campaign.status = EmailCampaign.Status.CANCELLED
        campaign.save(update_fields=['status'])
        return

    total_sent = 0
    for member_id, email in audience[:chunk_size]:
        try:
            dispatch(
                marina=campaign.marina,
                channel='email',
                recipient=email,
                subject=variant.subject,
                body=variant.body_html,
            )
            total_sent += 1
        except Exception:
            pass

    variant.sent_count += total_sent
    variant.save(update_fields=['sent_count'])

    campaign.status = EmailCampaign.Status.SENT
    campaign.sent_at = timezone.now()
    campaign.total_sent = total_sent
    campaign.save(update_fields=['status', 'sent_at', 'total_sent'])


def pick_ab_test_winner(ab_test_id):
    """
    Compare A/B variant metrics and send the winner to the remainder of the audience.
    """
    from apps.communications.models import ABTest, EmailCampaign, EmailCampaignVariant
    from apps.communications.services.dispatch import dispatch
    from apps.members.models import Member

    try:
        ab_test = ABTest.objects.select_related('campaign', 'campaign__marina').get(pk=ab_test_id)
    except ABTest.DoesNotExist:
        return

    if ab_test.winner_variant:
        return  # Already picked

    variants = list(ab_test.campaign.variants.all())
    if len(variants) < 2:
        return

    metric = ab_test.winner_metric
    if metric == ABTest.WinnerMetric.OPEN_RATE:
        winner = max(variants, key=lambda v: v.open_rate)
    else:
        winner = max(variants, key=lambda v: v.click_rate)

    ab_test.winner_variant = winner
    ab_test.winner_sent_at = timezone.now()
    ab_test.save(update_fields=['winner_variant', 'winner_sent_at'])

    if ab_test.winner_action == ABTest.WinnerAction.AUTO_SEND:
        campaign = ab_test.campaign
        segment = campaign.segment
        if segment:
            filter_params = segment.filter_params or {}
            audience = Member.objects.filter(marina=campaign.marina, **filter_params)
        else:
            audience = Member.objects.filter(marina=campaign.marina)

        audience = audience.exclude(email='').values_list('email', flat=True)

        for email in audience:
            try:
                dispatch(
                    marina=campaign.marina,
                    channel='email',
                    recipient=email,
                    subject=winner.subject,
                    body=winner.body_html,
                )
            except Exception:
                pass

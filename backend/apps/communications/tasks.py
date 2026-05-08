from celery import shared_task


@shared_task
def evaluate_journey_steps():
    from apps.communications.services.journey import evaluate_all_due_enrollments
    evaluate_all_due_enrollments()


@shared_task
def send_scheduled_campaigns():
    from django.utils import timezone
    from apps.communications.models import EmailCampaign
    from apps.communications.services.campaigns import send_campaign_batch
    for campaign in EmailCampaign.objects.filter(status='scheduled', scheduled_at__lte=timezone.now()):
        send_campaign_batch(campaign.pk)


@shared_task
def pick_ab_test_winner():
    from apps.communications.services.campaigns import pick_ab_test_winner as _pick
    from apps.communications.models import ABTest
    from django.utils import timezone
    from datetime import timedelta
    for test in ABTest.objects.filter(winner_variant__isnull=True):
        hold_end = test.campaign.sent_at + timedelta(hours=test.hold_hours) if test.campaign.sent_at else None
        if hold_end and timezone.now() >= hold_end:
            _pick(test.pk)


@shared_task
def send_review_requests():
    pass  # implement in services/reviews.py


@shared_task
def sync_dotdigital_segments():
    pass  # implement in services/dotdigital.py

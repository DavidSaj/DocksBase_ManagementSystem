from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Send all scheduled email campaigns that are due.'

    def handle(self, *args, **options):
        from django.utils import timezone
        from apps.communications.models import EmailCampaign
        from apps.communications.services.campaigns import send_campaign_batch
        campaigns = EmailCampaign.objects.filter(
            status='scheduled',
            scheduled_at__lte=timezone.now(),
        )
        for campaign in campaigns:
            send_campaign_batch(campaign.pk)
            self.stdout.write(f'Sent campaign: {campaign.name}')
        self.stdout.write(self.style.SUCCESS('Done.'))

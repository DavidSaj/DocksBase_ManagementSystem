from django.core.management.base import BaseCommand
from django.utils import timezone
from apps.accounts.models import Marina
from apps.tenants.services.rent_scheduler import run_rent_scheduler, create_rent_review_tasks


class Command(BaseCommand):
    help = 'Run the monthly rent scheduler and rent review task creator for all marinas.'

    def handle(self, *args, **options):
        today = timezone.now().date()
        marinas = Marina.objects.filter(is_active=True)
        for marina in marinas:
            self.stdout.write(f'Processing marina: {marina}')
            run_rent_scheduler(marina, today.year, today.month)
            create_rent_review_tasks(marina)
        self.stdout.write(self.style.SUCCESS('Rent scheduler complete.'))

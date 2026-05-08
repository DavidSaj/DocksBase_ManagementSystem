from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Check for vessel non-returns and create BerthAlert records.'

    def handle(self, *args, **options):
        from apps.berths.tasks import check_non_returns
        check_non_returns()
        self.stdout.write(self.style.SUCCESS('Non-return check complete.'))

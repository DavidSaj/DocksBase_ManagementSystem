from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Evaluate all due journey enrollment steps and advance them.'

    def handle(self, *args, **options):
        from apps.communications.services.journey import evaluate_all_due_enrollments
        evaluate_all_due_enrollments()
        self.stdout.write(self.style.SUCCESS('Journey steps evaluated.'))

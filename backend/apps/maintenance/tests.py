from django.test import TestCase
from apps.accounts.models import Marina
from apps.maintenance.models import Incident, MaintenanceTask


def make_marina():
    return Marina.objects.create(name='Test Marina')


class ModelTest(TestCase):
    def setUp(self):
        self.marina = make_marina()

    def test_incident_has_notes_field(self):
        inc = Incident.objects.create(
            marina=self.marina,
            description='Fire on dock',
            severity='high',
            occurred_at='2026-05-01T09:00:00Z',
        )
        inc.notes = 'Updated by harbour master'
        inc.save()
        self.assertEqual(Incident.objects.get(pk=inc.pk).notes, 'Updated by harbour master')

    def test_maintenance_task_creates(self):
        task = MaintenanceTask.objects.create(
            marina=self.marina,
            title='Fix gate lock',
            priority='high',
            status='pending',
        )
        self.assertEqual(str(task), 'Task: Fix gate lock')

    def test_maintenance_task_str(self):
        task = MaintenanceTask.objects.create(
            marina=self.marina,
            title='Repaint pontoon',
        )
        self.assertEqual(str(task), 'Task: Repaint pontoon')

from datetime import date
from unittest.mock import patch, MagicMock
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.notifications.models import Notification
from apps.notifications.utils import notify


class NotifyHelperTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='mgr@test.com', password='pass', marina=self.marina, role='manager'
        )

    @patch('apps.notifications.utils.get_channel_layer')
    @patch('apps.notifications.utils.async_to_sync')
    def test_notify_creates_db_row(self, mock_a2s, mock_gcl):
        mock_a2s.return_value = lambda fn: lambda *a, **kw: None
        notify(
            marina=self.marina,
            recipient=self.user,
            kind='booking_request',
            title='New booking',
            body='Vessel Lady K, 3 nights',
            link_screen='reservations',
            link_id=42,
        )
        self.assertEqual(Notification.objects.filter(recipient=self.user).count(), 1)
        n = Notification.objects.get(recipient=self.user)
        self.assertEqual(n.kind, 'booking_request')
        self.assertEqual(n.link_id, 42)
        self.assertFalse(n.read)

    @patch('apps.notifications.utils.get_channel_layer')
    @patch('apps.notifications.utils.async_to_sync')
    def test_notify_calls_channel_layer(self, mock_a2s, mock_gcl):
        mock_layer = MagicMock()
        mock_gcl.return_value = mock_layer
        send_fn = MagicMock()
        # async_to_sync(fn) returns a callable that wraps fn
        mock_a2s.return_value = send_fn
        notify(
            marina=self.marina,
            recipient=self.user,
            kind='overdue_invoice',
            title='Invoice overdue',
            body='INV-0042 overdue',
            link_screen='billing',
        )
        send_fn.assert_called_once()


class NotificationViewTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='View Test Marina')
        self.user = User.objects.create_user(
            email='view@test.com', password='pass', marina=self.marina, role='manager'
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.notif = Notification.objects.create(
            marina=self.marina, recipient=self.user,
            kind='booking_request', title='Test', body='Body',
            link_screen='reservations',
        )

    def test_list_returns_own_notifications(self):
        r = self.client.get('/api/v1/notifications/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()), 1)

    def test_mark_one_read(self):
        r = self.client.patch(f'/api/v1/notifications/{self.notif.pk}/read/')
        self.assertEqual(r.status_code, 200)
        self.notif.refresh_from_db()
        self.assertTrue(self.notif.read)

    def test_mark_all_read(self):
        Notification.objects.create(
            marina=self.marina, recipient=self.user,
            kind='overdue_invoice', title='T2', body='B2',
            link_screen='billing',
        )
        r = self.client.post('/api/v1/notifications/mark-all-read/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Notification.objects.filter(recipient=self.user, read=False).count(), 0)

    def test_cannot_see_other_users_notifications(self):
        other = User.objects.create_user(
            email='other@test.com', password='pass', marina=self.marina, role='staff'
        )
        Notification.objects.create(
            marina=self.marina, recipient=other,
            kind='booking_request', title='Other', body='OB',
            link_screen='reservations',
        )
        r = self.client.get('/api/v1/notifications/')
        self.assertEqual(len(r.json()), 1)  # only own

    def test_unauthenticated_cannot_list(self):
        anon = APIClient()
        r = anon.get('/api/v1/notifications/')
        self.assertEqual(r.status_code, 401)

    def test_mark_read_returns_404_for_nonexistent(self):
        r = self.client.patch('/api/v1/notifications/99999/read/')
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json()['detail'], 'Not found.')

    def test_mark_read_returns_404_for_other_users_notification(self):
        other = User.objects.create_user(
            email='other2@test.com', password='pass', marina=self.marina, role='staff'
        )
        other_notif = Notification.objects.create(
            marina=self.marina, recipient=other,
            kind='booking_request', title='Other', body='OB',
            link_screen='reservations',
        )
        r = self.client.patch(f'/api/v1/notifications/{other_notif.pk}/read/')
        self.assertEqual(r.status_code, 404)

    def test_mark_all_read_response_structure(self):
        # Create a second unread notification (setUp already created one)
        Notification.objects.create(
            marina=self.marina, recipient=self.user,
            kind='overdue_invoice', title='T2', body='B2',
            link_screen='billing',
        )
        unread_count = Notification.objects.filter(recipient=self.user, read=False).count()
        r = self.client.post('/api/v1/notifications/mark-all-read/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['updated'], unread_count)


@patch('apps.notifications.utils.get_channel_layer', return_value=None)
class NotificationSignalTests(TestCase):
    """
    Tests for signal handlers wired in apps/notifications/signals.py.

    get_channel_layer is patched to None so _push_to_ws exits early and
    we don't need a real channel layer in the test runner.
    """

    def setUp(self):
        self.marina = Marina.objects.create(name='Signal Marina')
        self.manager = User.objects.create_user(
            email='mgr2@test.com', password='pass', marina=self.marina, role='manager'
        )

    # ------------------------------------------------------------------
    # BookingRequest signal
    # ------------------------------------------------------------------

    def test_booking_request_notifies_managers(self, _mock_gcl):
        from apps.berths.models import Berth
        from apps.reservations.models import BookingRequest
        berth = Berth.objects.create(marina=self.marina, code='A1')
        BookingRequest.objects.create(
            marina=self.marina,
            guest_name='Test Guest',
            booking_type='transient',
            start_date=date.today(),
            end_date=date.today(),
            berth=berth,
        )
        self.assertTrue(
            Notification.objects.filter(
                recipient=self.manager, kind='booking_request'
            ).exists()
        )

    def test_booking_request_no_duplicate_on_update(self, _mock_gcl):
        """Updating a BookingRequest must not fire a new notification."""
        from apps.berths.models import Berth
        from apps.reservations.models import BookingRequest
        berth = Berth.objects.create(marina=self.marina, code='A2')
        br = BookingRequest.objects.create(
            marina=self.marina,
            guest_name='Guest 2',
            booking_type='transient',
            start_date=date.today(),
            end_date=date.today(),
            berth=berth,
        )
        count_after_create = Notification.objects.filter(kind='booking_request').count()
        br.notes = 'Updated note'
        br.save()
        self.assertEqual(
            Notification.objects.filter(kind='booking_request').count(),
            count_after_create,
        )

    # ------------------------------------------------------------------
    # Maintenance Task signal
    # ------------------------------------------------------------------

    def test_maintenance_task_assigned_notifies(self, _mock_gcl):
        from apps.maintenance.models import Task
        task = Task.objects.create(
            marina=self.marina, text='Fix pump', priority='medium'
        )
        task.assigned_to = 'John'
        task.save()
        self.assertTrue(
            Notification.objects.filter(
                recipient=self.manager, kind='maintenance_assigned'
            ).exists()
        )

    def test_maintenance_task_no_notify_if_already_assigned(self, _mock_gcl):
        """Re-assignment (non-blank → non-blank) should NOT fire again."""
        from apps.maintenance.models import Task
        task = Task.objects.create(
            marina=self.marina, text='Fix pump', assigned_to='John', priority='medium'
        )
        count_before = Notification.objects.filter(kind='maintenance_assigned').count()
        task.assigned_to = 'Jane'
        task.save()
        self.assertEqual(
            Notification.objects.filter(kind='maintenance_assigned').count(),
            count_before,
        )

    def test_maintenance_task_no_notify_if_created_unassigned(self, _mock_gcl):
        """Creating a task with no assignee should produce no notification."""
        from apps.maintenance.models import Task
        Task.objects.create(
            marina=self.marina, text='Unassigned task', priority='low'
        )
        self.assertFalse(
            Notification.objects.filter(kind='maintenance_assigned').exists()
        )

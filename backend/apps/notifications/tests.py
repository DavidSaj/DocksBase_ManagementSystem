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

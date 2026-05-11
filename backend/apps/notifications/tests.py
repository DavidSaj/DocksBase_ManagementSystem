from unittest.mock import patch, MagicMock
from django.test import TestCase
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

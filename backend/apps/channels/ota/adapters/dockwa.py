from apps.channels.ota.base import OTAAdapter


class DockwaAdapter(OTAAdapter):
    def push_availability(self, berths, date_from, date_to) -> dict:
        raise NotImplementedError('Dockwa push_availability not yet implemented')

    def pull_bookings(self, since) -> list:
        raise NotImplementedError('Dockwa pull_bookings not yet implemented')

    def cancel_booking(self, ota_ref) -> bool:
        raise NotImplementedError('Dockwa cancel_booking not yet implemented')

    def parse_webhook_payload(self, payload) -> list:
        # Stub — parse Dockwa webhook format
        return []

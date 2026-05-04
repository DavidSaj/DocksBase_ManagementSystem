export function deriveState(booking) {
  if (booking.self_checked_in) return 'wallet';
  if (!booking.pre_cleared) return 'checklist';
  if (booking.is_arrival_day) return 'arrival';
  return 'countdown';
}

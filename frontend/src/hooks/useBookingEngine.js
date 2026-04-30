// frontend/src/hooks/useBookingEngine.js
import api from '../api.js';

export default function useBookingEngine() {
  async function checkAvailability({ checkIn, checkOut, boatLoa, boatBeam }) {
    const params = { check_in: checkIn, check_out: checkOut };
    if (boatLoa) params.boat_loa = boatLoa;
    if (boatBeam) params.boat_beam = boatBeam;
    const { data } = await api.get('/bookings/available-berths/', { params });
    return data;
  }

  async function submitRequest({ checkIn, checkOut, boatLoa, boatBeam, guestName, guestEmail, guestPhone }) {
    const { data } = await api.post('/bookings/engine-request/', {
      check_in: checkIn,
      check_out: checkOut,
      boat_loa: boatLoa || null,
      boat_beam: boatBeam || null,
      guest_name: guestName || '',
      guest_email: guestEmail || '',
      guest_phone: guestPhone || '',
    });
    return data;
  }

  return { checkAvailability, submitRequest };
}

import { useState } from 'react';
import SearchScreen from './SearchScreen';
import OptionsScreen from './OptionsScreen';
import AlternativesScreen from './AlternativesScreen';
import QuoteScreen from './QuoteScreen';
import BookingRequestSent from './BookingRequestSent';
import ReservationConfirmedScreen from './ReservationConfirmedScreen';

const INITIAL_STATE = {
  checkIn: '', checkOut: '',
  boats: [{ loa: '', beam: '', draft: '', category: null, categories: [] }],
  quotedTotal: null,
  alternatives: [],
  errorBanner: '',
  reservationReference: null,
  reservationStatus: null,
};

export default function BookingWizard({ marina }) {
  const [screen, setScreen] = useState('search');
  const [state, setState]   = useState(INITIAL_STATE);

  const navigate = (nextScreen, updates = {}) => {
    setState(s => ({ ...s, ...updates, errorBanner: updates.errorBanner ?? '' }));
    setScreen(nextScreen);
  };

  if (screen === 'options')       return <OptionsScreen state={state} navigate={navigate} marina={marina} />;
  if (screen === 'alternatives')  return <AlternativesScreen state={state} navigate={navigate} />;
  if (screen === 'quote')         return <QuoteScreen state={state} navigate={navigate} marina={marina} />;
  if (screen === 'sent')          return <BookingRequestSent marina={marina} />;
  if (screen === 'confirmed')     return <ReservationConfirmedScreen state={state} marina={marina} />;
  return <SearchScreen state={state} navigate={navigate} marina={marina} />;
}

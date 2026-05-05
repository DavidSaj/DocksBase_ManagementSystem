import Autocomplete from 'react-google-autocomplete'
import styles from './StepMarina.module.css'

const CURRENCIES = ['EUR', 'GBP', 'USD', 'DKK', 'SEK', 'NOK']

export default function StepMarina({ form, patch, onBack, onNext }) {
  const valid =
    form.marinaName.trim() &&
    form.address.trim() &&
    form.phone.trim() &&
    form.contactEmail.trim() &&
    form.currency

  function handlePlaceSelected(place) {
    const lat = place.geometry?.location?.lat()
    const lng = place.geometry?.location?.lng()
    patch({
      address: place.formatted_address || '',
      lat: lat ?? null,
      lng: lng ?? null,
    })
  }

  return (
    <div>
      <h2 className={styles.title}>Your marina</h2>
      <p className={styles.sub}>Tell us about the marina you manage.</p>
      <div className={styles.form}>
        <div>
          <label className={styles.label}>Marina name *</label>
          <input className={styles.input} value={form.marinaName} onChange={e => patch({ marinaName: e.target.value })} placeholder="Harbour View Marina" />
        </div>

        <div>
          <label className={styles.label}>Address *</label>
          <Autocomplete
            apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
            className={styles.input}
            defaultValue={form.address}
            onPlaceSelected={handlePlaceSelected}
            options={{ types: ['geocode', 'establishment'] }}
            placeholder="Start typing your marina address…"
          />
        </div>

        <div className={styles.row}>
          <div>
            <label className={styles.label}>Phone *</label>
            <input className={styles.input} value={form.phone} onChange={e => patch({ phone: e.target.value })} placeholder="+44 1326 312345" />
          </div>
          <div>
            <label className={styles.label}>Contact email *</label>
            <input className={styles.input} type="email" value={form.contactEmail} onChange={e => patch({ contactEmail: e.target.value })} placeholder="info@yourmarina.com" />
          </div>
        </div>

        <div className={styles.row}>
          <div>
            <label className={styles.label}>VAT number</label>
            <input className={styles.input} value={form.vatNumber} onChange={e => patch({ vatNumber: e.target.value })} placeholder="GB123456789" />
          </div>
          <div>
            <label className={styles.label}>Currency *</label>
            <select className={styles.input} value={form.currency} onChange={e => patch({ currency: e.target.value })}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>
      <div className={styles.actions}>
        <button className={styles.backBtn} onClick={onBack} type="button">← Back</button>
        <button className={styles.nextBtn} onClick={onNext} disabled={!valid} type="button">Continue →</button>
      </div>
    </div>
  )
}

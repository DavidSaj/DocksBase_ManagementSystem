import { useState } from 'react'
import AutocompleteLib from 'react-google-autocomplete'
import styles from './StepMarina.module.css'

const Autocomplete = AutocompleteLib.default ?? AutocompleteLib
const CURRENCIES = ['EUR', 'GBP', 'USD', 'CHF', 'DKK', 'SEK', 'NOK']
const GOOGLE_API_KEY = import.meta.env.PUBLIC_GOOGLE_MAPS_API_KEY

function validate(form) {
  const errors = {}

  if (!form.marinaName.trim())
    errors.marinaName = 'Required'
  else if (form.marinaName.trim().length < 2)
    errors.marinaName = 'Name is too short'

  if (!form.address.trim())
    errors.address = 'Required'
  else if (form.address.trim().length < 5)
    errors.address = 'Enter a full address'

  if (!form.phone.trim()) {
    errors.phone = 'Required'
  } else {
    // strip spaces/dashes/parens, count remaining digits
    const digits = form.phone.replace(/[\s\-().]/g, '')
    if (!/^\+?[\d]{7,15}$/.test(digits))
      errors.phone = 'Enter a valid phone number (e.g. +44 1326 312345)'
  }

  if (!form.contactEmail.trim())
    errors.contactEmail = 'Required'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail))
    errors.contactEmail = 'Enter a valid email'

  return errors
}

export default function StepMarina({ form, patch, onBack, onNext }) {
  const [errors, setErrors] = useState({})

  function handlePlaceSelected(place) {
    const lat = place.geometry?.location?.lat()
    const lng = place.geometry?.location?.lng()
    patch({
      address: place.formatted_address || '',
      lat: lat ?? null,
      lng: lng ?? null,
    })
    setErrors(e => ({ ...e, address: undefined }))
  }

  function handleNext() {
    const errs = validate(form)
    if (Object.keys(errs).length) {
      setErrors(errs)
      return
    }
    onNext()
  }

  function field(name) {
    return {
      className: `${styles.input} ${errors[name] ? styles.inputError : ''}`,
      onChange: e => {
        patch({ [name]: e.target.value })
        if (errors[name]) setErrors(er => ({ ...er, [name]: undefined }))
      },
    }
  }

  return (
    <div>
      <h2 className={styles.title}>Your marina</h2>
      <p className={styles.sub}>Tell us about the marina you manage.</p>
      <div className={styles.form}>

        <div>
          <label className={styles.label}>Marina name *</label>
          <input {...field('marinaName')} value={form.marinaName} placeholder="Harbour View Marina" />
          {errors.marinaName && <span className={styles.error}>{errors.marinaName}</span>}
        </div>

        <div>
          <label className={styles.label}>Address *</label>
          {GOOGLE_API_KEY ? (
            <Autocomplete
              apiKey={GOOGLE_API_KEY}
              className={`${styles.input} ${errors.address ? styles.inputError : ''}`}
              defaultValue={form.address}
              onPlaceSelected={handlePlaceSelected}
              options={{ types: ['geocode', 'establishment'] }}
              placeholder="Start typing your marina address…"
            />
          ) : (
            <input
              {...field('address')}
              value={form.address}
              placeholder="Marina address"
            />
          )}
          {errors.address && <span className={styles.error}>{errors.address}</span>}
        </div>

        <div className={styles.row}>
          <div>
            <label className={styles.label}>Phone *</label>
            <input {...field('phone')} value={form.phone} placeholder="+44 1326 312345" />
            {errors.phone && <span className={styles.error}>{errors.phone}</span>}
          </div>
          <div>
            <label className={styles.label}>Contact email *</label>
            <input {...field('contactEmail')} type="email" value={form.contactEmail} placeholder="info@yourmarina.com" />
            {errors.contactEmail && <span className={styles.error}>{errors.contactEmail}</span>}
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
        <button className={styles.nextBtn} onClick={handleNext} type="button">Continue →</button>
      </div>
    </div>
  )
}

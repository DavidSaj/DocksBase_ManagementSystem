import { useState } from 'react'
import AutocompleteLib from 'react-google-autocomplete'
import { getSignupStrings } from '../../i18n/signup-strings'
import styles from './StepMarina.module.css'

const Autocomplete = AutocompleteLib.default ?? AutocompleteLib
const CURRENCIES = ['EUR', 'GBP', 'USD', 'CHF', 'DKK', 'SEK', 'NOK']
const GOOGLE_API_KEY = import.meta.env.PUBLIC_GOOGLE_MAPS_API_KEY

function validate(form, t) {
  const e = t.stepMarina.errors
  const errors = {}

  if (!form.marinaName.trim())
    errors.marinaName = e.required
  else if (form.marinaName.trim().length < 2)
    errors.marinaName = e.nameTooShort

  if (!form.address.trim())
    errors.address = e.required
  else if (form.address.trim().length < 5)
    errors.address = e.addressTooShort

  if (!form.phone.trim()) {
    errors.phone = e.required
  } else {
    const digits = form.phone.replace(/[\s\-().]/g, '')
    if (!/^\+?[\d]{7,15}$/.test(digits))
      errors.phone = e.phoneInvalid
  }

  if (!form.contactEmail.trim())
    errors.contactEmail = e.required
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail))
    errors.contactEmail = e.emailInvalid

  return errors
}

export default function StepMarina({ form, patch, onBack, onNext, t }) {
  const tr = t || getSignupStrings('en')
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
    const errs = validate(form, tr)
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

  const L = tr.stepMarina.labels
  const P = tr.stepMarina.placeholders

  return (
    <div>
      <h2 className={styles.title}>{tr.stepMarina.title}</h2>
      <p className={styles.sub}>{tr.stepMarina.sub}</p>
      <div className={styles.form}>

        <div>
          <label className={styles.label}>{L.marinaName}</label>
          <input {...field('marinaName')} value={form.marinaName} placeholder={P.marinaName} />
          {errors.marinaName && <span className={styles.error}>{errors.marinaName}</span>}
        </div>

        <div>
          <label className={styles.label}>{L.address}</label>
          {GOOGLE_API_KEY ? (
            <Autocomplete
              apiKey={GOOGLE_API_KEY}
              className={`${styles.input} ${errors.address ? styles.inputError : ''}`}
              defaultValue={form.address}
              onPlaceSelected={handlePlaceSelected}
              options={{ types: ['geocode', 'establishment'] }}
              placeholder={P.address}
            />
          ) : (
            <input
              {...field('address')}
              value={form.address}
              placeholder={P.addressFallback}
            />
          )}
          {errors.address && <span className={styles.error}>{errors.address}</span>}
        </div>

        <div className={styles.row}>
          <div>
            <label className={styles.label}>{L.phone}</label>
            <input {...field('phone')} value={form.phone} placeholder={P.phone} />
            {errors.phone && <span className={styles.error}>{errors.phone}</span>}
          </div>
          <div>
            <label className={styles.label}>{L.contactEmail}</label>
            <input {...field('contactEmail')} type="email" value={form.contactEmail} placeholder={P.contactEmail} />
            {errors.contactEmail && <span className={styles.error}>{errors.contactEmail}</span>}
          </div>
        </div>

        <div className={styles.row}>
          <div>
            <label className={styles.label}>{L.vatNumber}</label>
            <input className={styles.input} value={form.vatNumber} onChange={e => patch({ vatNumber: e.target.value })} placeholder={P.vatNumber} />
          </div>
          <div>
            <label className={styles.label}>{L.currency}</label>
            <select className={styles.input} value={form.currency} onChange={e => patch({ currency: e.target.value })}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

      </div>
      <div className={styles.actions}>
        <button className={styles.backBtn} onClick={onBack} type="button">{tr.stepMarina.back}</button>
        <button className={styles.nextBtn} onClick={handleNext} type="button">{tr.stepMarina.continue}</button>
      </div>
    </div>
  )
}

import { useState } from 'react'
import styles from './StepAccount.module.css'

function PasswordStrength({ password }) {
  const score = [/.{8,}/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(password)).length
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong']
  const colors = ['', '#e05555', '#d4b07a', '#2a9d99', '#38a860']
  if (!password) return null
  return (
    <div className={styles.strength}>
      <div className={styles.strengthBars}>
        {[1,2,3,4].map(i => (
          <div key={i} className={styles.strengthBar} style={{ background: i <= score ? colors[score] : 'rgba(12,31,61,0.1)' }} />
        ))}
      </div>
      <span style={{ color: colors[score], fontSize: 11, fontWeight: 600 }}>{labels[score]}</span>
    </div>
  )
}

export default function StepAccount({ form, patch, onBack, onSubmit, apiError }) {
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState({})

  const valid =
    form.firstName.trim() && form.lastName.trim() &&
    form.email.trim() && form.password.length >= 8

  async function handleNext() {
    setLoading(true)
    setErrors({})
    const errs = await onSubmit()
    if (errs) setErrors(errs)
    setLoading(false)
  }

  return (
    <div>
      <h2 className={styles.title}>Your account</h2>
      <p className={styles.sub}>This will be the owner account for your marina.</p>
      <div className={styles.form}>
        <div className={styles.row}>
          <div>
            <label className={styles.label}>First name *</label>
            <input className={styles.input} value={form.firstName} onChange={e => patch({ firstName: e.target.value })} placeholder="David" />
          </div>
          <div>
            <label className={styles.label}>Last name *</label>
            <input className={styles.input} value={form.lastName} onChange={e => patch({ lastName: e.target.value })} placeholder="Smith" />
          </div>
        </div>
        <div>
          <label className={styles.label}>Email address *</label>
          <input className={`${styles.input} ${errors.email ? styles.inputError : ''}`} type="email" value={form.email} onChange={e => patch({ email: e.target.value })} placeholder="you@yourmarina.com" />
          {errors.email && <p className={styles.fieldError}>{Array.isArray(errors.email) ? errors.email[0] : errors.email}</p>}
        </div>
        <div>
          <label className={styles.label}>Password * (min. 8 characters)</label>
          <input className={`${styles.input} ${errors.password ? styles.inputError : ''}`} type="password" value={form.password} onChange={e => patch({ password: e.target.value })} placeholder="••••••••" />
          <PasswordStrength password={form.password} />
          {errors.password && <p className={styles.fieldError}>{Array.isArray(errors.password) ? errors.password[0] : errors.password}</p>}
        </div>
      </div>
      {apiError && <p className={styles.apiError}>{apiError}</p>}
      <div className={styles.actions}>
        <button className={styles.backBtn} onClick={onBack} type="button" disabled={loading}>← Back</button>
        <button className={styles.nextBtn} onClick={handleNext} disabled={!valid || loading} type="button">
          {loading ? 'Setting up…' : 'Continue →'}
        </button>
      </div>
    </div>
  )
}

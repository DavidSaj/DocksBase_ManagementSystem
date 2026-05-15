import { useState, useEffect } from 'react'
import ProgressBar from './ProgressBar'
import StepPlan from './StepPlan'
import StepMarina from './StepMarina'
import StepAccount from './StepAccount'
import StepPayment from './StepPayment'
import StepConfirmation from './StepConfirmation'
import styles from './SignupPage.module.css'

const API = import.meta.env.PUBLIC_API_URL || ''

export default function SignupPage({ resume = false }) {
  const [step, setStep] = useState(1)
  const [dir, setDir] = useState(1)
  const [form, setForm] = useState({
    plan: null,
    marinaCount: 1,
    marinaName: '', address: '', lat: null, lng: null,
    phone: '', contactEmail: '', vatNumber: '', currency: 'EUR',
    firstName: '', lastName: '', email: '', password: '',
  })
  const [clientSecret, setClientSecret] = useState(null)
  const [apiError, setApiError] = useState(null)

  function goTo(n) {
    setDir(n > step ? 1 : -1)
    setStep(n)
  }

  // Resume flow: token in query string → skip to step 4
  useEffect(() => {
    if (!resume) return
    const token = new URLSearchParams(window.location.search).get('token')
    if (!token) return
    fetch(`${API}/api/v1/auth/onboarding/resume/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.client_secret) {
          setClientSecret(data.client_secret)
          setForm(f => ({ ...f, marinaName: data.marina_name || '' }))
          setDir(1)
          setStep(4)
        }
      })
      .catch(() => {})
  }, [resume])

  function patch(fields) { setForm(f => ({ ...f, ...fields })) }

  async function submitDraft() {
    setApiError(null)
    const body = {
      plan_price_id: form.plan.stripePriceId,
      marina_count:  form.marinaCount,
      marina_name:   form.marinaName,
      address:       form.address,
      lat:           form.lat,
      lng:           form.lng,
      phone:         form.phone,
      contact_email: form.contactEmail,
      vat_number:    form.vatNumber,
      currency:      form.currency,
      first_name:    form.firstName,
      last_name:     form.lastName,
      email:         form.email,
      password:      form.password,
    }
    const resp = await fetch(`${API}/api/v1/auth/onboarding/draft/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await resp.json()
    if (!resp.ok) return data
    setClientSecret(data.client_secret)
    setDir(1)
    setStep(4)
    return null
  }

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <div className={styles.logo}>DocksBase</div>
          <p className={styles.sub}>Start your 30-day free trial</p>
        </div>
        {step < 5 && <ProgressBar step={step} />}
        <div className={styles.stepWrap}>
          <div key={step} className={dir > 0 ? styles.slideIn : styles.slideInBack}>
            {step === 1 && <StepPlan form={form} patch={patch} onNext={() => goTo(2)} />}
            {step === 2 && <StepMarina form={form} patch={patch} onBack={() => goTo(1)} onNext={() => goTo(3)} />}
            {step === 3 && <StepAccount form={form} patch={patch} onBack={() => goTo(2)} onSubmit={submitDraft} apiError={apiError} />}
            {step === 4 && clientSecret && <StepPayment clientSecret={clientSecret} marinaName={form.marinaName} plan={form.plan} marinaCount={form.marinaCount} />}
            {step === 5 && <StepConfirmation />}
          </div>
        </div>
      </div>
    </div>
  )
}

import { useState, useMemo } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { getSignupStrings } from '../../i18n/signup-strings'
import styles from './StepPayment.module.css'

const stripePromise = loadStripe(import.meta.env.PUBLIC_STRIPE_PUBLISHABLE_KEY)

const WEBSITE_URL = import.meta.env.PUBLIC_WEBSITE_URL || (typeof window !== 'undefined' ? window.location.origin : '')

function PaymentForm({ marinaName, plan, marinaCount, t }) {
  const tr = t
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!stripe || !elements) return
    setLoading(true)
    setError(null)

    // Build success URL that preserves the current language segment.
    let successUrl = `${WEBSITE_URL}/signup/success`
    if (typeof window !== 'undefined') {
      const m = window.location.pathname.match(/^\/([a-z]{2})\//)
      if (m) successUrl = `${WEBSITE_URL}/${m[1]}/signup/success`
    }

    const { error: stripeError } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: successUrl },
    })

    if (stripeError) {
      setError(stripeError.message)
      setLoading(false)
    }
  }

  const total = useMemo(() => {
    if (!plan) return null
    const count = marinaCount || 1
    const isEnterprise = plan.key === 'enterprise' && plan.addonPricePerMarina && count > 1
    return isEnterprise
      ? plan.monthlyPrice + (count - 1) * plan.addonPricePerMarina
      : plan.monthlyPrice
  }, [plan, marinaCount])

  const planName = plan ? (tr.plans[plan.key]?.name || plan.name) : ''

  return (
    <form onSubmit={handleSubmit}>
      <div className={styles.summary}>
        <div>
          <span className={styles.summaryMarina}>{marinaName || tr.stepPayment.summary.yourMarina}</span>
          {plan && (
            <span className={styles.summaryPlan}>
              {planName}{marinaCount > 1 ? tr.stepPayment.summary.marinasSuffix(marinaCount) : ''}
            </span>
          )}
        </div>
        <div className={styles.summaryPrice}>
          <span className={styles.freeToday}>{tr.stepPayment.summary.freeToday}</span>
          {total != null && <span className={styles.thenPrice}>{tr.stepPayment.summary.thenPerMonth(total)}</span>}
        </div>
      </div>

      <div className={styles.elementWrap}>
        <PaymentElement />
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <button className={styles.submitBtn} type="submit" disabled={loading || !stripe}>
        {loading ? tr.stepPayment.processing : tr.stepPayment.submit}
      </button>

      <div className={styles.trustRow}>
        <span className={styles.trustItem}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          {tr.stepPayment.trust.noCharge}
        </span>
        <span className={styles.trustDot} />
        <span className={styles.trustItem}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          {tr.stepPayment.trust.cancel}
        </span>
        <span className={styles.trustDot} />
        <span className={styles.trustItem}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          {tr.stepPayment.trust.fullAccess}
        </span>
      </div>
    </form>
  )
}

export default function StepPayment({ clientSecret, marinaName, plan, marinaCount, t }) {
  const tr = t || getSignupStrings('en')
  const options = useMemo(() => ({
    clientSecret,
    appearance: {
      theme: 'stripe',
      variables: {
        colorPrimary: '#0c1f3d',
        colorBackground: '#ffffff',
        fontFamily: 'Jost, system-ui, sans-serif',
        borderRadius: '6px',
      },
    },
  }), [clientSecret])

  return (
    <div>
      <h2 className={styles.title}>{tr.stepPayment.title}</h2>
      <p className={styles.sub}>{tr.stepPayment.sub}</p>

      <div className={styles.trialBanner}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        {tr.stepPayment.trialBanner}
      </div>

      <Elements stripe={stripePromise} options={options}>
        <PaymentForm marinaName={marinaName} plan={plan} marinaCount={marinaCount} t={tr} />
      </Elements>
    </div>
  )
}

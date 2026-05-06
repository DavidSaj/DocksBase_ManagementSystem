import { useState, useMemo } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import styles from './StepPayment.module.css'

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)

const WEBSITE_URL = import.meta.env.VITE_WEBSITE_URL || (typeof window !== 'undefined' ? window.location.origin : '')

function PaymentForm({ marinaName, plan, marinaCount }) {
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!stripe || !elements) return
    setLoading(true)
    setError(null)

    const { error: stripeError } = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: `${WEBSITE_URL}/signup/success`,
      },
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

  return (
    <form onSubmit={handleSubmit}>
      <div className={styles.summary}>
        <div>
          <span className={styles.summaryMarina}>{marinaName || 'Your marina'}</span>
          {plan && (
            <span className={styles.summaryPlan}>
              {plan.name}{marinaCount > 1 ? ` × ${marinaCount} marinas` : ''}
            </span>
          )}
        </div>
        <div className={styles.summaryPrice}>
          <span className={styles.freeToday}>€0 today</span>
          {total != null && <span className={styles.thenPrice}>then €{total}/mo</span>}
        </div>
      </div>

      <div className={styles.elementWrap}>
        <PaymentElement />
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <button className={styles.submitBtn} type="submit" disabled={loading || !stripe}>
        {loading ? 'Processing…' : 'Start free trial — no charge today →'}
      </button>

      <div className={styles.trustRow}>
        <span className={styles.trustItem}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          No charge today
        </span>
        <span className={styles.trustDot} />
        <span className={styles.trustItem}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Cancel anytime
        </span>
        <span className={styles.trustDot} />
        <span className={styles.trustItem}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Full access from day one
        </span>
      </div>
    </form>
  )
}

export default function StepPayment({ clientSecret, marinaName, plan, marinaCount }) {
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
      <h2 className={styles.title}>Your first 30 days are free</h2>
      <p className={styles.sub}>Add your card to get started — you won't be charged until your trial ends.</p>

      <div className={styles.trialBanner}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        30-day free trial &nbsp;·&nbsp; No credit card charge today &nbsp;·&nbsp; Cancel before it ends and pay nothing
      </div>

      <Elements stripe={stripePromise} options={options}>
        <PaymentForm marinaName={marinaName} plan={plan} marinaCount={marinaCount} />
      </Elements>
    </div>
  )
}

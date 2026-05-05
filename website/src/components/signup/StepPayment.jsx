import { useState, useMemo } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import styles from './StepPayment.module.css'

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)

const WEBSITE_URL = import.meta.env.VITE_WEBSITE_URL || (typeof window !== 'undefined' ? window.location.origin : '')

function PaymentForm({ marinaName, plan }) {
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
    // On success Stripe redirects to return_url — no further action needed
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className={styles.summary}>
        <span className={styles.summaryMarina}>{marinaName || 'Your marina'}</span>
        {plan && (
          <span className={styles.summaryPlan}>
            {plan.name} — €{plan.monthlyPrice}/mo after trial
          </span>
        )}
      </div>
      <div className={styles.elementWrap}>
        <PaymentElement />
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.submitBtn} type="submit" disabled={loading || !stripe}>
        {loading ? 'Processing…' : 'Start 30-day free trial →'}
      </button>
      <p className={styles.note}>Your card won't be charged during the trial. Cancel anytime.</p>
    </form>
  )
}

export default function StepPayment({ clientSecret, marinaName, plan }) {
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
      <h2 className={styles.title}>Payment details</h2>
      <p className={styles.sub}>Your card will not be charged until your 30-day trial ends.</p>
      <Elements stripe={stripePromise} options={options}>
        <PaymentForm marinaName={marinaName} plan={plan} />
      </Elements>
    </div>
  )
}

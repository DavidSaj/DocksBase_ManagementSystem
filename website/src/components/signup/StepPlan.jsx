import { PLANS } from '../../config/plans'
import styles from './StepPlan.module.css'

export default function StepPlan({ form, patch, onNext }) {
  const isEnterprise = form.plan?.key === 'enterprise'
  const count = form.marinaCount || 1
  const totalPrice = isEnterprise
    ? form.plan.monthlyPrice + (count - 1) * form.plan.addonPricePerMarina
    : form.plan?.monthlyPrice ?? null

  function setCount(n) {
    patch({ marinaCount: Math.max(1, Math.min(20, n)) })
  }

  return (
    <div>
      <h2 className={styles.title}>Choose your plan</h2>
      <p className={styles.sub}>All plans include a 30-day free trial. Cancel anytime.</p>
      <div className={styles.grid}>
        {PLANS.map(plan => (
          <button
            key={plan.key}
            className={`${styles.card} ${form.plan?.key === plan.key ? styles.selected : ''}`}
            onClick={() => patch({ plan, marinaCount: 1 })}
            type="button"
          >
            {plan.badge && <span className={styles.badge}>{plan.badge}</span>}
            <div className={styles.planName}>{plan.name}</div>
            <div className={styles.price}>
              <span className={styles.amount}>€{plan.monthlyPrice}</span>
              <span className={styles.period}>/mo{plan.addonPricePerMarina ? '*' : ''}</span>
            </div>
            <div className={styles.tagline}>{plan.tagline}</div>
            <ul className={styles.features}>
              {plan.features.map(f => (
                <li key={f} className={styles.feature}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>

      {isEnterprise && (
        <div className={styles.marinaCounter}>
          <span className={styles.counterLabel}>How many marinas?</span>
          <div className={styles.counter}>
            <button
              type="button"
              className={styles.counterBtn}
              onClick={() => setCount(count - 1)}
              disabled={count <= 1}
              aria-label="Remove marina"
            >−</button>
            <span className={styles.counterValue}>{count}</span>
            <button
              type="button"
              className={styles.counterBtn}
              onClick={() => setCount(count + 1)}
              disabled={count >= 20}
              aria-label="Add marina"
            >+</button>
          </div>
          <div className={styles.counterBreakdown}>
            €899 base
            {count > 1 && <> + {count - 1} × €{form.plan.addonPricePerMarina}</>}
            {' '}= <strong>€{totalPrice}/mo</strong> after trial
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <button
          className={styles.nextBtn}
          onClick={onNext}
          disabled={!form.plan}
          type="button"
        >
          Continue →
        </button>
      </div>
    </div>
  )
}

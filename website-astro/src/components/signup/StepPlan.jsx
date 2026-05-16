import { PLANS } from '../../config/plans'
import { getSignupStrings } from '../../i18n/signup-strings'
import styles from './StepPlan.module.css'

export default function StepPlan({ form, patch, onNext, t }) {
  const tr = t || getSignupStrings('en')
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
      <h2 className={styles.title}>{tr.stepPlan.title}</h2>
      <p className={styles.sub}>{tr.stepPlan.sub}</p>
      <div className={styles.grid}>
        {PLANS.map(plan => {
          const planT = tr.plans[plan.key] || {}
          const name = planT.name || plan.name
          const tagline = planT.tagline || plan.tagline
          const badge = planT.badge || plan.badge
          const features = planT.features || plan.features
          return (
            <button
              key={plan.key}
              className={`${styles.card} ${form.plan?.key === plan.key ? styles.selected : ''}`}
              onClick={() => patch({ plan, marinaCount: 1 })}
              type="button"
            >
              {badge && <span className={styles.badge}>{badge}</span>}
              <div className={styles.planName}>{name}</div>
              <div className={styles.price}>
                <span className={styles.amount}>€{plan.monthlyPrice}</span>
                <span className={styles.period}>{tr.stepPlan.perMonthShort}{plan.addonPricePerMarina ? '*' : ''}</span>
              </div>
              <div className={styles.tagline}>{tagline}</div>
              <ul className={styles.features}>
                {features.map(f => (
                  <li key={f} className={styles.feature}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
            </button>
          )
        })}
      </div>

      {isEnterprise && (
        <div className={styles.marinaCounter}>
          <span className={styles.counterLabel}>{tr.stepPlan.counterLabel}</span>
          <div className={styles.counter}>
            <button
              type="button"
              className={styles.counterBtn}
              onClick={() => setCount(count - 1)}
              disabled={count <= 1}
              aria-label={tr.stepPlan.counterRemoveAria}
            >−</button>
            <span className={styles.counterValue}>{count}</span>
            <button
              type="button"
              className={styles.counterBtn}
              onClick={() => setCount(count + 1)}
              disabled={count >= 20}
              aria-label={tr.stepPlan.counterAddAria}
            >+</button>
          </div>
          <div className={styles.counterBreakdown}>
            {tr.stepPlan.base}
            {count > 1 && <> + {count - 1} × €{form.plan.addonPricePerMarina}</>}
            {' '}= <strong>€{totalPrice}{tr.stepPlan.perMonthShort}</strong> {tr.stepPlan.afterTrial}
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
          {tr.stepPlan.continue}
        </button>
      </div>
    </div>
  )
}

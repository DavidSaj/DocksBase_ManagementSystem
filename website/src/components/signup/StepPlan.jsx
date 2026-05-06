import { PLANS } from '../../config/plans'
import styles from './StepPlan.module.css'

export default function StepPlan({ form, patch, onNext }) {
  return (
    <div>
      <h2 className={styles.title}>Choose your plan</h2>
      <p className={styles.sub}>All plans include a 30-day free trial. Cancel anytime.</p>
      <div className={styles.grid}>
        {PLANS.map(plan => (
          <button
            key={plan.key}
            className={`${styles.card} ${form.plan?.key === plan.key ? styles.selected : ''}`}
            onClick={() => patch({ plan })}
            type="button"
          >
            {plan.badge && <span className={styles.badge}>{plan.badge}</span>}
            <div className={styles.planName}>{plan.name}</div>
            <div className={styles.price}>
              <span className={styles.amount}>€{plan.monthlyPrice}</span>
              <span className={styles.period}>/mo</span>
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

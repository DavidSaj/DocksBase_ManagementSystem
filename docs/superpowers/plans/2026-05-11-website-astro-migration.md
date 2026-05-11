# Website → Astro Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the DocksBase marketing website from a React SPA (Vite) to Astro with URL-based i18n routing so every language gets its own indexable page.

**Architecture:** New Astro project at `website-astro/` alongside the existing `website/`. Static marketing components become `.astro` files (zero JS shipped). Interactive components (Nav, Faq, FeatureRequest) stay as React islands with `client:load`. Each language gets its own URL (`/en/`, `/de/`, `/nl/`, etc.) via a `[lang]` dynamic route with `getStaticPaths`. The signup flow stays as a React island at `/signup`.

**Tech Stack:** Astro 5, `@astrojs/react`, React 19, CSS Modules (same as existing), TypeScript for the i18n strings module.

---

## File Map

**New files (create):**
- `website-astro/astro.config.mjs` — Astro config with React integration
- `website-astro/package.json`
- `website-astro/tsconfig.json`
- `website-astro/src/i18n/strings.ts` — all translation strings (extracted from `LanguageContext.jsx`)
- `website-astro/src/layouts/Base.astro` — `<html>`, `<head>`, fonts, global CSS, hreflang tags, ScrollReveal script
- `website-astro/src/styles/global.css` — CSS variables, resets, `.sr`/`.sr-in` animation (copied from `index.css`)
- `website-astro/src/pages/index.astro` — redirects `/` → `/en/`
- `website-astro/src/pages/[lang]/index.astro` — landing page, generates `/en/`, `/de/`, etc.
- `website-astro/src/pages/signup/index.astro` — wraps React SignupPage island
- `website-astro/src/pages/signup/resume.astro` — wraps React SignupPage with `resume` prop
- `website-astro/src/pages/signup/success.astro` — wraps React SignupSuccessPage island
- `website-astro/src/components/Nav.tsx` — React island (complex interactions + language routing via URL)
- `website-astro/src/components/Hero.astro` — static, receives `t` prop from page
- `website-astro/src/components/WhiteLabel.astro` — static, receives `t` prop
- `website-astro/src/components/FeatureRequest.tsx` — React island (form state), receives `t` prop
- `website-astro/src/components/Faq.tsx` — React island (accordion state)
- `website-astro/src/components/TrustBar.astro`
- `website-astro/src/components/Features.astro`
- `website-astro/src/components/Stats.astro`
- `website-astro/src/components/ProductSection.astro`
- `website-astro/src/components/SplitSection.astro`
- `website-astro/src/components/MobileApp.astro`
- `website-astro/src/components/Pricing.astro`
- `website-astro/src/components/CTA.astro`
- `website-astro/src/components/Footer.astro`
- `website-astro/src/components/Logo.astro`
- `website-astro/src/components/AboutModal.tsx` — React island
- `website-astro/src/components/signup/` — copy all signup `.tsx` files from old `website/`

**Copy as-is (no changes needed):**
- All `*.module.css` files from `website/src/components/` → `website-astro/src/components/`
- `website/public/` → `website-astro/public/`

**Old `website/` directory:** Leave in place until migration is verified.

---

## Task 1: Bootstrap Astro project

**Files:**
- Create: `website-astro/package.json`
- Create: `website-astro/astro.config.mjs`
- Create: `website-astro/tsconfig.json`

- [ ] **Step 1: Create the directory and package.json**

```bash
mkdir DocksBase_ManagementSystem/website-astro
cd DocksBase_ManagementSystem/website-astro
```

Create `website-astro/package.json`:

```json
{
  "name": "docksbase-website",
  "type": "module",
  "version": "0.0.0",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "@astrojs/react": "^4.2.0",
    "@stripe/react-stripe-js": "^6.3.0",
    "@stripe/stripe-js": "^9.4.0",
    "astro": "^5.7.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-google-autocomplete": "^2.7.5",
    "react-router-dom": "^7.15.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0"
  }
}
```

- [ ] **Step 2: Create astro.config.mjs**

```js
// website-astro/astro.config.mjs
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'

export default defineConfig({
  integrations: [react()],
  output: 'static',
})
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  }
}
```

- [ ] **Step 4: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Create minimal src/pages/index.astro to verify Astro works**

```astro
---
---
<html><body><h1>DocksBase</h1></body></html>
```

- [ ] **Step 6: Run dev server**

```bash
npm run dev
```

Expected: Astro dev server starts at `http://localhost:4321`, page renders "DocksBase".

- [ ] **Step 7: Commit**

```bash
git add website-astro/
git commit -m "feat(website): bootstrap Astro project"
```

---

## Task 2: Extract i18n strings module

**Files:**
- Create: `website-astro/src/i18n/strings.ts`

- [ ] **Step 1: Create the strings module**

Create `website-astro/src/i18n/strings.ts`. Copy the entire `strings` object and `LANGUAGES` array from `website/src/context/LanguageContext.jsx`, and add TypeScript types:

```ts
// website-astro/src/i18n/strings.ts

export const LANGUAGES = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'de', label: 'DE', name: 'Deutsch' },
  { code: 'nl', label: 'NL', name: 'Nederlands' },
  { code: 'it', label: 'IT', name: 'Italiano' },
  { code: 'es', label: 'ES', name: 'Español' },
  { code: 'fr', label: 'FR', name: 'Français' },
  { code: 'el', label: 'EL', name: 'Ελληνικά' },
] as const

export type LangCode = typeof LANGUAGES[number]['code']

export interface Strings {
  nav: {
    features: string; product: string; pricing: string; about: string
    signIn: string; getStarted: string
    aboutItems: { aboutUs: string; blog: string; faq: string; documentation: string; status: string }
  }
  hero: {
    eyebrow: string; title1: string; titleEm: string; title2: string
    sub: string; cta1: string; cta2: string
  }
  trust: string
  features: { eyebrow: string; title: string; sub: string; allModules: string; allModulesSub: string }
  product: { eyebrow: string; title: string; sub: string; demo: string }
  pricing: { eyebrow: string; title: string; sub: string; note: string }
  cta: { title1: string; titleEm: string; sub: string; btn1: string; btn2: string; note: string }
  whiteLabel: {
    eyebrow: string; title: string; body: string
    checklist: string[]; cta: string; flowSteps: string[]; poweredBy: string
  }
  featureRequest: {
    eyebrow: string; title: string; sub: string
    placeholder: string; btn: string; note: string; success: string
  }
  footer: {
    tagline: string; product: string; company: string; support: string; copy: string
    productLinks: string[]; companyLinks: string[]; supportLinks: string[]
  }
}

const strings: Record<LangCode, Strings> = {
  // ── paste the full strings object from LanguageContext.jsx here ──
  // (en, de, nl, it, es, fr, el keys with all their nested values)
  en: { /* ... copy from LanguageContext.jsx ... */ },
  de: { /* ... copy from LanguageContext.jsx ... */ },
  nl: { /* ... copy from LanguageContext.jsx ... */ },
  it: { /* ... copy from LanguageContext.jsx ... */ },
  es: { /* ... copy from LanguageContext.jsx ... */ },
  fr: { /* ... copy from LanguageContext.jsx ... */ },
  el: { /* ... copy from LanguageContext.jsx ... */ },
}

export function getStrings(lang: LangCode): Strings {
  return strings[lang] ?? strings.en
}

export function getLangPath(lang: LangCode): string {
  return `/${lang}/`
}
```

**Important:** Copy the full content of each language key verbatim from `website/src/context/LanguageContext.jsx` lines 3–511. Do not abbreviate.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build
```

Expected: Builds without type errors (page is still the stub from Task 1).

- [ ] **Step 3: Commit**

```bash
git add website-astro/src/i18n/
git commit -m "feat(website): add i18n strings module with 7 languages"
```

---

## Task 3: Base layout + global CSS

**Files:**
- Create: `website-astro/src/styles/global.css`
- Create: `website-astro/src/layouts/Base.astro`

- [ ] **Step 1: Create global.css**

Copy `website/src/index.css` verbatim to `website-astro/src/styles/global.css`. No changes needed — the CSS variables, resets, font imports, and `.sr`/`.sr-in` animation are identical.

- [ ] **Step 2: Create Base.astro**

```astro
---
// website-astro/src/layouts/Base.astro
import '../styles/global.css'
import type { LangCode } from '../i18n/strings'
import { LANGUAGES, getLangPath } from '../i18n/strings'

interface Props {
  lang: LangCode
  title?: string
  description?: string
}

const {
  lang,
  title = 'DocksBase — The Complete Harbor Management Platform',
  description = 'From berth assignments to billing, DocksBase gives harbor masters every operational tool in one cloud-based system.',
} = Astro.props
---
<!doctype html>
<html lang={lang}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />

    <!-- hreflang tags for SEO -->
    {LANGUAGES.map(l => (
      <link rel="alternate" hreflang={l.code} href={`https://docksbase.io${getLangPath(l.code)}`} />
    ))}
    <link rel="alternate" hreflang="x-default" href="https://docksbase.io/en/" />
  </head>
  <body>
    <slot />

    <!-- ScrollReveal: applies .sr-in to .sr elements as they enter viewport -->
    <script>
      const obs = new IntersectionObserver(
        (entries) => entries.forEach(e => {
          if (e.isIntersecting) { e.target.classList.add('sr-in'); obs.unobserve(e.target) }
        }),
        { threshold: 0.08 }
      )
      document.querySelectorAll('.sr').forEach(el => obs.observe(el))
    </script>
  </body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add website-astro/src/styles/ website-astro/src/layouts/
git commit -m "feat(website): add base layout with hreflang and scroll reveal"
```

---

## Task 4: Nav as React island

The Nav has complex client-side state (scroll detection, dropdowns, mobile menu, AboutModal). Language switching navigates to the new URL instead of calling `setLang`.

**Files:**
- Create: `website-astro/src/components/Nav.tsx`
- Create: `website-astro/src/components/Nav.module.css` (copy from old)
- Create: `website-astro/src/components/AboutModal.tsx` (copy from old)
- Create: `website-astro/src/components/AboutModal.module.css` (copy from old)
- Create: `website-astro/src/components/Logo.tsx` (copy from old, rename .jsx → .tsx)

- [ ] **Step 1: Copy CSS and Logo**

```bash
cp website/src/components/Nav.module.css website-astro/src/components/Nav.module.css
cp website/src/components/AboutModal.module.css website-astro/src/components/AboutModal.module.css
cp website/src/components/Logo.jsx website-astro/src/components/Logo.tsx
```

- [ ] **Step 2: Copy AboutModal.tsx**

```bash
cp website/src/components/AboutModal.jsx website-astro/src/components/AboutModal.tsx
```

No content changes needed in AboutModal — it has no language dependency.

- [ ] **Step 3: Create Nav.tsx**

```tsx
// website-astro/src/components/Nav.tsx
import { useState, useEffect, useRef } from 'react'
import styles from './Nav.module.css'
import Logo from './Logo'
import AboutModal from './AboutModal'
import { LANGUAGES, type LangCode, type Strings } from '../i18n/strings'

interface Props {
  lang: LangCode
  t: Strings
}

const ABOUT_ITEMS = [
  { key: 'aboutUs',       icon: '⚓', internal: true },
  { key: 'faq',           icon: '?', href: '#faq' },
  { key: 'documentation', icon: '↗', href: 'https://docs.docksbase.io', external: true },
  { key: 'status',        icon: '●', href: 'https://status.docksbase.io', external: true },
] as const

export default function Nav({ lang, t }: Props) {
  const [scrolled, setScrolled]     = useState(false)
  const [menuOpen, setMenuOpen]     = useState(false)
  const [aboutOpen, setAboutOpen]   = useState(false)
  const [langOpen, setLangOpen]     = useState(false)
  const [aboutModal, setAboutModal] = useState(false)
  const aboutRef                    = useRef<HTMLDivElement>(null)
  const langRef                     = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (aboutRef.current && !aboutRef.current.contains(e.target as Node)) setAboutOpen(false)
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const handleAboutItem = (item: typeof ABOUT_ITEMS[number]) => {
    setAboutOpen(false)
    if (item.internal) { setAboutModal(true); return }
    if (item.external) { window.open(item.href, '_blank', 'noopener'); return }
    window.location.href = item.href
  }

  return (
    <>
      <nav className={`${styles.nav} ${scrolled ? styles.scrolled : ''}`}>
        <a href={`/${lang}/`} className={styles.logo}><Logo /></a>

        <div className={styles.links}>
          <a href="#features" className={styles.link}>{t.nav.features}</a>
          <a href="#product"  className={styles.link}>{t.nav.product}</a>
          <a href="#pricing"  className={styles.link}>{t.nav.pricing}</a>

          <div className={styles.aboutWrap} ref={aboutRef}>
            <button
              className={`${styles.link} ${styles.aboutTrigger} ${aboutOpen ? styles.aboutTriggerOpen : ''}`}
              onClick={() => setAboutOpen(o => !o)}
            >
              {t.nav.about}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 3.5l3 3 3-3"/>
              </svg>
            </button>
            {aboutOpen && (
              <div className={styles.dropdown}>
                {ABOUT_ITEMS.map(item => (
                  <button
                    key={item.key}
                    className={`${styles.dropItem} ${item.external ? styles.dropExternal : ''}`}
                    onClick={() => handleAboutItem(item)}
                  >
                    <span className={styles.dropIcon}>{item.icon}</span>
                    <span className={styles.dropLabel}>{t.nav.aboutItems[item.key]}</span>
                    {item.external && (
                      <svg className={styles.extIcon} width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M2 10L10 2M5 2h5v5"/>
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.right}>
          <div className={styles.langWrap} ref={langRef}>
            <button
              className={`${styles.langTrigger} ${langOpen ? styles.langTriggerOpen : ''}`}
              onClick={() => setLangOpen(o => !o)}
            >
              {LANGUAGES.find(l => l.code === lang)?.label ?? 'EN'}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2 3.5l3 3 3-3"/>
              </svg>
            </button>
            {langOpen && (
              <div className={styles.langDropdown}>
                {LANGUAGES.map(l => (
                  <a
                    key={l.code}
                    href={`/${l.code}/`}
                    className={`${styles.langDropItem} ${lang === l.code ? styles.langDropActive : ''}`}
                    onClick={() => setLangOpen(false)}
                  >
                    <span className={styles.langCode}>{l.label}</span>
                    <span className={styles.langName}>{l.name}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
          <button className={styles.ghost}>{t.nav.signIn}</button>
          <a href="/signup/" className={styles.cta}>{t.nav.getStarted}</a>
        </div>

        <button
          className={`${styles.hamburger} ${menuOpen ? styles.open : ''}`}
          onClick={() => setMenuOpen(o => !o)}
          aria-label="Menu"
        >
          <span /><span /><span />
        </button>
      </nav>

      <div className={`${styles.mobileMenu} ${menuOpen ? styles.menuOpen : ''}`}>
        <a href="#features" className={styles.mobileLink} onClick={() => setMenuOpen(false)}>{t.nav.features}</a>
        <a href="#product"  className={styles.mobileLink} onClick={() => setMenuOpen(false)}>{t.nav.product}</a>
        <a href="#pricing"  className={styles.mobileLink} onClick={() => setMenuOpen(false)}>{t.nav.pricing}</a>
        <div className={styles.mobileAbout}>
          <span className={styles.mobileSectionLabel}>{t.nav.about}</span>
          {ABOUT_ITEMS.map(item => (
            <button
              key={item.key}
              className={styles.mobileSub}
              onClick={() => { setMenuOpen(false); handleAboutItem(item) }}
            >
              {t.nav.aboutItems[item.key]}
              {item.external && ' ↗'}
            </button>
          ))}
        </div>
        <div className={styles.mobileActions}>
          <div className={styles.mobileLangRow}>
            {LANGUAGES.map(l => (
              <a
                key={l.code}
                href={`/${l.code}/`}
                className={`${styles.mobileLangBtn} ${lang === l.code ? styles.mobileLangActive : ''}`}
              >{l.label}</a>
            ))}
          </div>
          <button className={styles.ghost} style={{ width: '100%', padding: '12px' }}>{t.nav.signIn}</button>
          <a href="/signup/" className={styles.cta} style={{ width: '100%', padding: '12px', display: 'block', textAlign: 'center' }}>{t.nav.getStarted}</a>
        </div>
      </div>

      {aboutModal && <AboutModal onClose={() => setAboutModal(false)} />}
    </>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add website-astro/src/components/Nav.tsx website-astro/src/components/Nav.module.css website-astro/src/components/AboutModal.tsx website-astro/src/components/AboutModal.module.css website-astro/src/components/Logo.tsx
git commit -m "feat(website): add Nav React island with URL-based language switching"
```

---

## Task 5: Translated .astro components (Hero, WhiteLabel)

**Files:**
- Create: `website-astro/src/components/Hero.astro`
- Create: `website-astro/src/components/Hero.module.css` (copy)
- Create: `website-astro/src/components/WhiteLabel.astro`
- Create: `website-astro/src/components/WhiteLabel.module.css` (copy)

- [ ] **Step 1: Copy CSS files**

```bash
cp website/src/components/Hero.module.css website-astro/src/components/Hero.module.css
cp website/src/components/WhiteLabel.module.css website-astro/src/components/WhiteLabel.module.css
```

- [ ] **Step 2: Create Hero.astro**

```astro
---
// website-astro/src/components/Hero.astro
import type { Strings } from '../i18n/strings'
import styles from './Hero.module.css'

interface Props { t: Strings }
const { t } = Astro.props
const h = t.hero
---
<section class={styles.hero}>
  <div class={styles.bgOuter}>
    <div class={styles.bgInner} />
  </div>
  <div class={styles.overlay} />
  <div class={styles.content}>
    <div class={styles.eyebrow}>{h.eyebrow}</div>
    <h1 class={styles.title}>
      <span class={styles.word1}>{h.title1}</span>{' '}
      <em class={styles.wordEm}>{h.titleEm}</em>
      <br />
      <span class={styles.word2}>{h.title2}</span>
    </h1>
    <p class={styles.sub}>{h.sub}</p>
    <div class={styles.actions}>
      <a href="/signup/" class={`${styles.btn} ${styles.btnPrimary}`}>
        {h.cta1}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </a>
      <a href="#features" class={`${styles.btn} ${styles.btnGhost}`}>{h.cta2}</a>
    </div>
  </div>
  <div class={styles.scroll}>
    <div class={styles.scrollLine} />
    <span class={styles.scrollText}>Scroll</span>
  </div>
</section>
```

**Note on Astro JSX differences:** In `.astro` files, HTML attributes use kebab-case (`stroke-width` not `strokeWidth`), and `class` not `className`. Template expressions use `{value}` exactly like JSX but the file is not JSX.

- [ ] **Step 3: Create WhiteLabel.astro**

```astro
---
// website-astro/src/components/WhiteLabel.astro
import type { Strings } from '../i18n/strings'
import styles from './WhiteLabel.module.css'

interface Props { t: Strings }
const { t } = Astro.props
const tr = t.whiteLabel
---
<section class={styles.section}>
  <div class={styles.inner}>
    <div class={styles.left}>
      <div class={styles.eyebrow}>{tr.eyebrow}</div>
      <h2 class={styles.title}>{tr.title}</h2>
      <p class={styles.body}>{tr.body}</p>

      <ul class={styles.checklist}>
        {tr.checklist.map((item) => (
          <li class={styles.checkItem}>
            <svg class={styles.checkIcon} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>{item}</span>
          </li>
        ))}
      </ul>

      <div class={styles.flow}>
        {tr.flowSteps.map((step, i) => (
          <div class={styles.flowRow}>
            <div class={styles.flowStep}>
              <div class={styles.flowDot}>{i + 1}</div>
              <span class={styles.flowText}>{step}</span>
            </div>
            {i < tr.flowSteps.length - 1 && (
              <svg class={styles.flowArrow} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            )}
          </div>
        ))}
      </div>

      <a href="#" class={styles.cta}>{tr.cta}</a>

      <div class={styles.hostedCard}>
        <div class={styles.hostedCardIcon}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </div>
        <div>
          <p class={styles.hostedCardTitle}>No custom domain? No problem.</p>
          <p class={styles.hostedCardBody}>
            We host your portal at{' '}
            <span class={styles.hostedUrl}>booking.docksbase.com/yourmarina</span>
            {' '}— live in minutes, zero DNS setup.
          </p>
        </div>
      </div>
    </div>

    <div class={styles.right}>
      <div class={styles.browser}>
        <div class={styles.chrome}>
          <div class={styles.dots}>
            <span class={styles.dot} style="background:#ff5f56" />
            <span class={styles.dot} style="background:#ffbd2e" />
            <span class={styles.dot} style="background:#27c93f" />
          </div>
          <div class={styles.urlBar}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4caf50" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span class={styles.urlText}>booking.yourmarina.com</span>
          </div>
        </div>
        <div class={styles.site}>
          <div class={styles.siteNav}>
            <div class={styles.siteLogo}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
              <span>Harbour View Marina</span>
            </div>
            <div class={styles.siteLinks}>
              <span>Berths</span><span>Facilities</span><span>Contact</span>
            </div>
          </div>
          <div class={styles.siteHero}>
            <div class={styles.siteHeroText}>
              <p class={styles.siteEyebrow}>Online Reservations</p>
              <h3 class={styles.siteHeadline}>Book a Berth</h3>
              <p class={styles.siteSub}>Check real-time availability and reserve your spot.</p>
            </div>
          </div>
          <div class={styles.siteForm}>
            <div class={styles.formRow}>
              <div class={styles.formField}><label>Arrival</label><div class={styles.formInput}>12 Aug 2026</div></div>
              <div class={styles.formField}><label>Departure</label><div class={styles.formInput}>15 Aug 2026</div></div>
              <div class={styles.formField}><label>Vessel length</label><div class={styles.formInput}>10 m</div></div>
            </div>
            <button class={styles.formBtn}>Check availability →</button>
          </div>
          <div class={styles.poweredBy}>{tr.poweredBy}</div>
        </div>
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 4: Commit**

```bash
git add website-astro/src/components/Hero.astro website-astro/src/components/Hero.module.css website-astro/src/components/WhiteLabel.astro website-astro/src/components/WhiteLabel.module.css
git commit -m "feat(website): add Hero and WhiteLabel Astro components"
```

---

## Task 6: Static .astro components (no translation)

These components have hardcoded English content. Convert JSX → Astro syntax (kebab-case SVG attributes, `class` not `className`). The logic and CSS are unchanged.

**Files to create:**
- `website-astro/src/components/TrustBar.astro`
- `website-astro/src/components/Features.astro`
- `website-astro/src/components/Stats.astro`
- `website-astro/src/components/ProductSection.astro`
- `website-astro/src/components/SplitSection.astro`
- `website-astro/src/components/MobileApp.astro`
- `website-astro/src/components/Pricing.astro`
- `website-astro/src/components/CTA.astro`
- `website-astro/src/components/Footer.astro`
- `website-astro/src/components/AnchorDivider.astro`
- Plus all corresponding `.module.css` files (copy as-is)

- [ ] **Step 1: Copy all CSS module files**

```bash
cp website/src/components/TrustBar.module.css    website-astro/src/components/
cp website/src/components/Features.module.css    website-astro/src/components/
cp website/src/components/Stats.module.css       website-astro/src/components/
cp website/src/components/ProductSection.module.css website-astro/src/components/
cp website/src/components/SplitSection.module.css website-astro/src/components/
cp website/src/components/MobileApp.module.css   website-astro/src/components/
cp website/src/components/Pricing.module.css     website-astro/src/components/
cp website/src/components/CTA.module.css         website-astro/src/components/
cp website/src/components/Footer.module.css      website-astro/src/components/
cp website/src/components/AnchorDivider.module.css website-astro/src/components/
```

- [ ] **Step 2: Convert each component**

For each file, open the `.jsx` source and create an `.astro` file with these rules:
1. Move imports to the frontmatter (`---` block)
2. Change `className=` → `class=`
3. Change SVG attributes to kebab-case: `strokeWidth` → `stroke-width`, `strokeLinecap` → `stroke-linecap`, `strokeLinejoin` → `stroke-linejoin`, `viewBox` stays camelCase (it's an SVG attribute, not HTML)
4. `style={{ color: 'red' }}` → `style="color:red"` (Astro uses string styles in HTML elements)
5. `.map()` with JSX children works the same in Astro templates
6. Remove `export default function` — Astro components don't export
7. Keep all CSS module `import styles from` inside the frontmatter

**SplitSection.astro** requires an interface for its props. Create it as:

```astro
---
// website-astro/src/components/SplitSection.astro
import styles from './SplitSection.module.css'

interface Props {
  eyebrow: string
  title: string
  body: string
  checklist: string[]
  cta: string
  image: string
  alt: string
  reverse?: boolean
  cream?: boolean
}

const { eyebrow, title, body, checklist, cta, image, alt, reverse = false, cream = false } = Astro.props
---
```

Then render the JSX content using `class` and kebab-case SVG attributes, same structure as the original.

**Footer.astro** — the current Footer is hardcoded in English. Keep it that way for now; i18n for footer can be added as a follow-up.

- [ ] **Step 3: Commit after all static components are done**

```bash
git add website-astro/src/components/
git commit -m "feat(website): convert static marketing components to Astro"
```

---

## Task 7: React island components (Faq, FeatureRequest)

**Files:**
- Create: `website-astro/src/components/Faq.tsx`
- Create: `website-astro/src/components/Faq.module.css` (copy)
- Create: `website-astro/src/components/FeatureRequest.tsx`
- Create: `website-astro/src/components/FeatureRequest.module.css` (copy)

- [ ] **Step 1: Copy CSS**

```bash
cp website/src/components/Faq.module.css          website-astro/src/components/
cp website/src/components/FeatureRequest.module.css website-astro/src/components/
```

- [ ] **Step 2: Create Faq.tsx**

Copy `website/src/components/Faq.jsx` verbatim to `website-astro/src/components/Faq.tsx`. No content changes needed — it has no language dependency and no imports to update.

- [ ] **Step 3: Create FeatureRequest.tsx**

FeatureRequest needs the `t` prop instead of `useLang`. Replace the import and hook:

```tsx
// website-astro/src/components/FeatureRequest.tsx
import { useState } from 'react'
import styles from './FeatureRequest.module.css'
import type { Strings } from '../i18n/strings'

interface Props { t: Strings }

export default function FeatureRequest({ t }: Props) {
  const tr = t.featureRequest
  const [value, setValue] = useState('')
  const [sent, setSent] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!value.trim()) return
    setSent(true)
  }

  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <div className={styles.left}>
          <div className={styles.eyebrow}>{tr.eyebrow}</div>
          <h2 className={styles.title}>{tr.title}</h2>
          <p className={styles.sub}>{tr.sub}</p>
        </div>
        <div className={styles.right}>
          {sent ? (
            <div className={styles.success}>
              <div className={styles.successIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <p className={styles.successText}>{tr.success}</p>
            </div>
          ) : (
            <form className={styles.form} onSubmit={handleSubmit}>
              <textarea
                className={styles.textarea}
                rows={5}
                placeholder={tr.placeholder}
                value={value}
                onChange={e => setValue(e.target.value)}
              />
              <div className={styles.formFooter}>
                <p className={styles.note}>{tr.note}</p>
                <button type="submit" className={styles.btn} disabled={!value.trim()}>
                  {tr.btn}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add website-astro/src/components/Faq.tsx website-astro/src/components/Faq.module.css website-astro/src/components/FeatureRequest.tsx website-astro/src/components/FeatureRequest.module.css
git commit -m "feat(website): add Faq and FeatureRequest React islands"
```

---

## Task 8: Landing page with i18n routing

**Files:**
- Create: `website-astro/src/pages/[lang]/index.astro`
- Create: `website-astro/src/pages/index.astro` (redirect)

- [ ] **Step 1: Create [lang]/index.astro**

```astro
---
// website-astro/src/pages/[lang]/index.astro
import Base from '../../layouts/Base.astro'
import Nav from '../../components/Nav'
import Hero from '../../components/Hero.astro'
import TrustBar from '../../components/TrustBar.astro'
import Features from '../../components/Features.astro'
import Stats from '../../components/Stats.astro'
import ProductSection from '../../components/ProductSection.astro'
import SplitSection from '../../components/SplitSection.astro'
import WhiteLabel from '../../components/WhiteLabel.astro'
import MobileApp from '../../components/MobileApp.astro'
import Pricing from '../../components/Pricing.astro'
import Faq from '../../components/Faq'
import FeatureRequest from '../../components/FeatureRequest'
import CTA from '../../components/CTA.astro'
import Footer from '../../components/Footer.astro'
import { LANGUAGES, getStrings, type LangCode } from '../../i18n/strings'

export function getStaticPaths() {
  return LANGUAGES.map(({ code }) => ({ params: { lang: code } }))
}

const { lang } = Astro.params as { lang: LangCode }
const t = getStrings(lang)
---
<Base lang={lang}>
  <Nav lang={lang} t={t} client:load />
  <Hero t={t} />
  <TrustBar />
  <Features />
  <Stats />
  <ProductSection />

  <SplitSection
    eyebrow="Built to Integrate"
    title="Fits your marina. Works with what you have."
    body="DocksBase is designed to slot into your existing operation — not replace it. Keep the tools your team already relies on and add DocksBase alongside them. Or run it fully standalone. Either way, you're up and running without disrupting a single season."
    checklist={[
      'No rip-and-replace — works alongside existing systems',
      'Connects with booking platforms and third-party apps',
      'Import your existing berth, vessel, and customer data',
      'Gradual rollout by department or pier at your pace',
      'Full standalone capability when you need it',
    ]}
    cta="See how it fits"
    image="/images/marina-aerial-close.jpg"
    alt="Aerial view of marina piers with boats"
  />
  <SplitSection
    eyebrow="Your Rules. Your Workflow."
    title="Manual control or smart algorithms — you decide."
    body="Some harbourmasters want full control over every berth assignment. Others want the system to handle it automatically. DocksBase supports both — switch between manual allocation and algorithmic optimisation at any time, for any pier."
    checklist={[
      'Manual mode: assign every berth yourself with full visibility',
      'Algorithmic mode: auto-assign by vessel size, draft, and stay length',
      'Sync incoming bookings from other booking platforms automatically',
      'Override algorithmic suggestions at any time',
      'Set rules per pier, per season, or per vessel type',
    ]}
    cta="Explore allocation modes"
    image="/images/marina-sailboats.jpg"
    alt="Sailboats moored in calm harbor"
    reverse
    cream
  />
  <SplitSection
    eyebrow="Complete Marina Platform"
    title="From arrival to invoice — every operation covered."
    body="DocksBase covers your full operation: live berth occupancy across all piers, a coordinated boatyard with crane schedules and work orders, and automated billing from berth fee to aged debtor. One system, one login, one source of truth."
    checklist={[
      'Real-time berth grid with walk-in and online bookings',
      'Haul-out queue, dry storage map, and work orders',
      'Automated invoices, utility billing, and fuel dock POS',
      'Aged debtor tracking with one-click chase workflow',
      'Export to CSV, PDF, XLSX or push to your accounts system',
    ]}
    cta="See the full platform"
    image="/images/marina-dock-boats.jpg"
    alt="Classic wooden boats at a dock"
  />

  <div class="sr"><WhiteLabel t={t} /></div>
  <MobileApp />
  <div class="sr"><Pricing /></div>
  <div class="sr"><Faq client:load /></div>
  <div class="sr"><FeatureRequest t={t} client:load /></div>
  <div class="sr"><CTA /></div>
  <Footer />
</Base>
```

- [ ] **Step 2: Create root redirect page**

```astro
---
// website-astro/src/pages/index.astro
return Astro.redirect('/en/', 301)
---
```

- [ ] **Step 3: Run dev server and verify**

```bash
npm run dev
```

Open `http://localhost:4321/en/` — landing page should render in English.
Open `http://localhost:4321/de/` — landing page should render in German (Nav, Hero, WhiteLabel, FeatureRequest translated).
Open `http://localhost:4321/` — should redirect to `/en/`.

- [ ] **Step 4: Commit**

```bash
git add website-astro/src/pages/
git commit -m "feat(website): add i18n landing pages for all 7 languages"
```

---

## Task 9: Signup pages

The signup flow has no language dependency. It uses React Router's `useSearchParams`, Stripe, and multi-step state — keep it all as a React island.

**Files:**
- Create: `website-astro/src/pages/signup/index.astro`
- Create: `website-astro/src/pages/signup/resume.astro`
- Create: `website-astro/src/pages/signup/success.astro`
- Copy: all files from `website/src/pages/` and `website/src/components/signup/` → `website-astro/src/components/signup/`

- [ ] **Step 1: Copy signup components**

```bash
mkdir -p website-astro/src/components/signup
cp website/src/components/signup/*.jsx website-astro/src/components/signup/
cp website/src/pages/SignupPage.jsx     website-astro/src/components/signup/SignupPage.jsx
cp website/src/pages/SignupSuccessPage.jsx website-astro/src/components/signup/SignupSuccessPage.jsx
```

Also copy any CSS modules for the signup flow:

```bash
cp website/src/pages/SignupPage.module.css website-astro/src/components/signup/
```

- [ ] **Step 2: Update import paths in SignupPage.jsx**

Open `website-astro/src/components/signup/SignupPage.jsx` and update the relative imports from `../components/signup/` to `./`:

```js
// Change:
import ProgressBar from '../components/signup/ProgressBar'
import StepPlan from '../components/signup/StepPlan'
// etc.

// To:
import ProgressBar from './ProgressBar'
import StepPlan from './StepPlan'
// etc.
```

Also change `import.meta.env.VITE_API_URL` to `import.meta.env.PUBLIC_API_URL` — Astro uses the `PUBLIC_` prefix for client-exposed env vars (not `VITE_`).

- [ ] **Step 3: Create signup Astro pages**

`website-astro/src/pages/signup/index.astro`:
```astro
---
import SignupPage from '../../components/signup/SignupPage'
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign up — DocksBase</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/src/styles/global.css" />
  </head>
  <body>
    <SignupPage client:load />
  </body>
</html>
```

`website-astro/src/pages/signup/resume.astro`:
```astro
---
import SignupPage from '../../components/signup/SignupPage'
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Resume signup — DocksBase</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  </head>
  <body>
    <SignupPage resume={true} client:load />
  </body>
</html>
```

`website-astro/src/pages/signup/success.astro`:
```astro
---
import SignupSuccessPage from '../../components/signup/SignupSuccessPage'
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Welcome to DocksBase</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  </head>
  <body>
    <SignupSuccessPage client:load />
  </body>
</html>
```

**Note:** The signup pages need the global CSS. Import it into the signup page `<head>` directly, or create a minimal `SignupLayout.astro` that imports `global.css` and wraps these pages.

- [ ] **Step 4: Add .env for API URL**

Create `website-astro/.env`:
```
PUBLIC_API_URL=
```

Update signup components to use `import.meta.env.PUBLIC_API_URL` instead of `import.meta.env.VITE_API_URL`.

- [ ] **Step 5: Test signup route**

```bash
npm run dev
```

Open `http://localhost:4321/signup/` — signup flow should render.

- [ ] **Step 6: Commit**

```bash
git add website-astro/src/pages/signup/ website-astro/src/components/signup/ website-astro/.env
git commit -m "feat(website): add signup pages as React islands"
```

---

## Task 10: Build verification

- [ ] **Step 1: Run production build**

```bash
npm run build
```

Expected: No errors. `dist/` is created with static HTML files.

- [ ] **Step 2: Verify output structure**

```bash
ls dist/
ls dist/en/
ls dist/de/
```

Expected: `dist/en/index.html`, `dist/de/index.html`, `dist/nl/index.html`, etc. Each file should contain actual translated HTML text (not blank JS-rendered placeholders).

- [ ] **Step 3: Check that landing page HTML contains readable text**

```bash
grep -c "harbor" dist/en/index.html
grep -c "Hafen" dist/de/index.html
```

Expected: Both return a count > 0 — confirms static HTML is rendered with translated content.

- [ ] **Step 4: Preview production build**

```bash
npm run preview
```

Open `http://localhost:4321/en/` and `http://localhost:4321/de/` — verify visuals match the old site. Check: Nav renders, language switcher navigates between `/en/` and `/de/`, signup CTA links to `/signup/`.

- [ ] **Step 5: Final commit**

```bash
git add website-astro/
git commit -m "feat(website): complete Astro migration with 7-language SEO routing"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Astro setup with React integration
- ✅ 7 languages as separate URLs (`/en/`, `/de/`, etc.)
- ✅ `hreflang` tags in `<head>`
- ✅ Static HTML for all marketing content (Hero, Features, SplitSection, etc.)
- ✅ Nav language switcher as URL navigation
- ✅ React islands for interactive components (Nav, Faq, FeatureRequest)
- ✅ Signup flow preserved as React island
- ✅ ScrollReveal via vanilla `<script>` (no React wrapper needed)
- ✅ All CSS Modules copied and usable unchanged
- ✅ `VITE_API_URL` → `PUBLIC_API_URL` for Astro env convention

**Known follow-ups (not in scope of this plan):**
- SplitSection, Features, Stats, ProductSection, MobileApp, Pricing, Faq, CTA, Footer content is still hardcoded English — translations for these sections should be added to `strings.ts` in a follow-up
- `react-router-dom` in signup: Astro handles routing natively, so `BrowserRouter`/`Routes`/`Route` wrappers in `SignupPage.jsx` should work since it's a client island, but if routing issues arise the fix is to remove the `BrowserRouter` from `SignupPage` and rely on Astro's file-based routing for `/signup/resume` and `/signup/success`

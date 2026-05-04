import { createContext, useContext, useEffect, useState } from 'react'
import api from '../api'

const TenantContext = createContext(null)

const BOOKING_HOSTNAME = 'booking.docksbase.com'
const APP_HOSTNAMES = new Set(['app.docksbase.com', 'www.docksbase.com', 'docksbase.com', 'localhost', '127.0.0.1'])

// Returns { slug, customDomain, prefill } or null (= management app)
export function detectTenant() {
  const { hostname, pathname, search } = window.location

  if (APP_HOSTNAMES.has(hostname)) return null

  const params = new URLSearchParams(search)
  const prefill = {}
  if (params.get('arrival'))   prefill.arrival   = params.get('arrival')
  if (params.get('departure')) prefill.departure = params.get('departure')
  if (params.get('category'))  prefill.category  = params.get('category')

  // Options 1 & 2: booking.docksbase.com/:slug
  if (hostname === BOOKING_HOSTNAME) {
    const slug = pathname.split('/').filter(Boolean)[0] ?? null
    return slug ? { slug, customDomain: null, prefill } : null
  }

  // Option 3: marina's own domain
  return { slug: null, customDomain: hostname, prefill }
}

export function TenantProvider({ children }) {
  const tenant = detectTenant()
  const [marina, setMarina] = useState(null)
  const [isLoading, setIsLoading] = useState(!!tenant)

  useEffect(() => {
    if (!tenant) return
    const headers = tenant.slug
      ? { 'X-Marina-Slug': tenant.slug }
      : { 'X-Marina-Domain': tenant.customDomain }
    api.get('/public/marina/', { headers })
      .then(res => setMarina(res.data))
      .catch(() => setMarina(null))
      .finally(() => setIsLoading(false))
  }, [])

  return (
    <TenantContext.Provider value={{
      tenantSlug:   tenant?.slug         ?? null,
      customDomain: tenant?.customDomain ?? null,
      prefill:      tenant?.prefill      ?? {},
      marina,
      isLoading,
    }}>
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant() {
  return useContext(TenantContext)
}

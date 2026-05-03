import { createContext, useContext, useEffect, useState } from 'react'
import api from '../api'

const TenantContext = createContext(null)

function getTenantSlug() {
  const hostname = window.location.hostname
  const parts = hostname.split('.')
  if (parts.length <= 1) return null
  const sub = parts[0]
  if (sub === 'app' || sub === 'www') return null
  return sub
}

export function TenantProvider({ children }) {
  const tenantSlug = getTenantSlug()
  const [marina, setMarina] = useState(null)
  const [isLoading, setIsLoading] = useState(!!tenantSlug)

  useEffect(() => {
    if (!tenantSlug) return
    api.get('/public/marina/', { headers: { 'X-Marina-Slug': tenantSlug } })
      .then(res => setMarina(res.data))
      .catch(() => setMarina(null))
      .finally(() => setIsLoading(false))
  }, [tenantSlug])

  return (
    <TenantContext.Provider value={{ tenantSlug, marina, isLoading }}>
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant() {
  return useContext(TenantContext)
}

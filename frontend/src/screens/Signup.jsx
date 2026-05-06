import { useEffect } from 'react'

export default function Signup() {
  useEffect(() => {
    window.location.href = `${import.meta.env.VITE_WEBSITE_URL || ''}/signup`
  }, [])
  return null
}

import { useState, useEffect, useCallback } from 'react'
import api from '../api.js'

export default function useLogicalPiers() {
  const [logicalPiers, setLogicalPiers] = useState([])
  const [loading,      setLoading]      = useState(true)

  const fetchLogicalPiers = useCallback(async () => {
    try {
      setLoading(true)
      const { data } = await api.get('/logical-piers/')
      setLogicalPiers(data.results ?? data)
    } catch (e) {
      console.error('[useLogicalPiers]', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchLogicalPiers() }, [fetchLogicalPiers])

  async function createLogicalPier(attrs) {
    const { data } = await api.post('/logical-piers/', attrs)
    setLogicalPiers(prev => [...prev, data])
    return data
  }

  return { logicalPiers, loading, refetch: fetchLogicalPiers, createLogicalPier }
}

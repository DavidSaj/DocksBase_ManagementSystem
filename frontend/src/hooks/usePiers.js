// frontend/src/hooks/usePiers.js
import { useState, useEffect, useCallback } from 'react'
import api from '../api.js'

export default function usePiers() {
  const [piers,   setPiers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const fetchPiers = useCallback(async () => {
    try {
      setLoading(true)
      const { data } = await api.get('/piers/')
      setPiers(data.results ?? data)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchPiers() }, [fetchPiers])

  async function createPier(attrs) {
    const { data } = await api.post('/piers/', attrs)
    setPiers(prev => [...prev, data])
    return data
  }

  async function updatePierCanvas(id, canvas_x, canvas_y, rotation = 0) {
    const { data } = await api.patch(`/piers/${id}/`, { canvas_x, canvas_y, rotation })
    setPiers(prev => prev.map(p => p.id === id ? data : p))
    return data
  }

  async function deletePier(id) {
    await api.delete(`/piers/${id}/`)
    setPiers(prev => prev.filter(p => p.id !== id))
  }

  return { piers, loading, error, refetch: fetchPiers, createPier, updatePierCanvas, deletePier }
}

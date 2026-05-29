import { useEffect, useState } from 'react'

export default function useDetailModal({ removePendingById, refreshCollection }) {
  const [detailId, setDetailId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailSaving, setDetailSaving] = useState(false)
  const [detailError, setDetailError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadDetail() {
      if (detailId === null) {
        setDetail(null)
        setDetailLoading(false)
        setDetailError('')
        return
      }

      try {
        setDetailLoading(true)
        setDetailError('')
        const response = await fetch(`/api/memes/${detailId}`)
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data?.detail || 'Could not load meme details.')
        }
        if (!cancelled) {
          setDetail(data)
        }
      } catch (error) {
        if (!cancelled) {
          setDetailError(error.message || 'Could not load meme details.')
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false)
        }
      }
    }

    loadDetail()

    return () => {
      cancelled = true
    }
  }, [detailId])

  function openDetail(meme) {
    setDetailId(meme.id)
    setDetail(meme)
    setDetailError('')
  }

  function closeDetail() {
    setDetailId(null)
    setDetail(null)
    setDetailSaving(false)
    setDetailError('')
  }

  async function saveMemeDetails(fields) {
    if (detailId === null) {
      return null
    }

    try {
      setDetailSaving(true)
      setDetailError('')
      const response = await fetch(`/api/memes/${detailId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.detail || 'Save failed.')
      }

      setDetail(data)
      removePendingById(detailId)
      refreshCollection()
      return data
    } catch (error) {
      setDetailError(error.message || 'Save failed.')
      throw error
    } finally {
      setDetailSaving(false)
    }
  }

  async function deleteMeme(id) {
    try {
      const response = await fetch(`/api/memes/${id}`, { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data?.detail || 'Delete failed.')
      }
      removePendingById(id)
      closeDetail()
      refreshCollection()
    } catch (error) {
      setDetailError(error.message || 'Delete failed.')
    }
  }

  return {
    detailId,
    detail,
    detailLoading,
    detailSaving,
    detailError,
    openDetail,
    closeDetail,
    saveMemeDetails,
    deleteMeme
  }
}

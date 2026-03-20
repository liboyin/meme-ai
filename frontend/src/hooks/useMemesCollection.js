import { useEffect, useMemo, useState } from 'react'

const PAGE_SIZE = 40

export default function useMemesCollection() {
  const [memes, setMemes] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [collectionError, setCollectionError] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function loadMemes() {
      try {
        setCollectionError('')
        const response = await fetch(`/api/memes?page=${page}&page_size=${PAGE_SIZE}`)
        if (!response.ok) {
          throw new Error('Could not load memes.')
        }
        const data = await response.json()
        if (cancelled) {
          return
        }
        setMemes(data.items || [])
        setTotal(data.total || 0)
      } catch (error) {
        if (!cancelled) {
          setCollectionError(error.message || 'Could not load memes.')
        }
      }
    }

    loadMemes()

    return () => {
      cancelled = true
    }
  }, [page, refreshToken])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])

  function refreshCollection() {
    setRefreshToken((value) => value + 1)
  }

  return {
    memes,
    page,
    setPage,
    total,
    totalPages,
    collectionError,
    refreshToken,
    refreshCollection,
    pageSize: PAGE_SIZE
  }
}

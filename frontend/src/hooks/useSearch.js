import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Manage fuzzy and AI-backed search state for the meme gallery.
 *
 * @returns {object} Search state and actions consumed by the app shell.
 */
export default function useSearch() {
  const [searchQuery, setRawSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchMode, setSearchMode] = useState('gallery')
  const [searchLoading, setSearchLoading] = useState(false)
  const [llmLoading, setLlmLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const latestQueryRef = useRef('')
  const aiRequestIdRef = useRef(0)

  const hasSearchQuery = useMemo(() => searchQuery.trim().length > 0, [searchQuery])

  /**
   * Update the query and reset stale AI results before fuzzy search refreshes.
   *
   * @param {string} nextQuery - New search query from the input.
   */
  function setSearchQuery(nextQuery) {
    const normalizedQuery = String(nextQuery)
    latestQueryRef.current = normalizedQuery
    aiRequestIdRef.current += 1
    setRawSearchQuery(normalizedQuery)
    setSearchMode('gallery')
    setSearchResults([])
    setSearchError('')
    setLlmLoading(false)
  }

  useEffect(() => {
    if (!hasSearchQuery) {
      setSearchResults([])
      setSearchMode('gallery')
      setSearchLoading(false)
      setSearchError('')
      return
    }

    if (searchMode === 'llm') {
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      try {
        setSearchLoading(true)
        setSearchError('')
        const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&mode=fuzzy`)
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data?.detail || 'Fuzzy search failed.')
        }
        if (cancelled) {
          return
        }
        setSearchMode('fuzzy')
        setSearchResults(data.items || [])
      } catch (error) {
        if (!cancelled) {
          setSearchMode('fuzzy')
          setSearchResults([])
          setSearchError(error.message || 'Fuzzy search failed.')
        }
      } finally {
        if (!cancelled) {
          setSearchLoading(false)
        }
      }
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [hasSearchQuery, searchQuery, searchMode])

  async function runAiSearch() {
    if (!hasSearchQuery) {
      return
    }

    const requestQuery = searchQuery.trim()
    const requestId = aiRequestIdRef.current + 1
    aiRequestIdRef.current = requestId

    try {
      setLlmLoading(true)
      setSearchError('')
      const response = await fetch('/api/search/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: requestQuery, top_n: 20 })
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error?.message || data?.detail || 'AI search failed.')
      }
      if (aiRequestIdRef.current !== requestId || latestQueryRef.current.trim() !== requestQuery) {
        return
      }
      setSearchMode('llm')
      setSearchResults(data.items || [])
    } catch (error) {
      if (aiRequestIdRef.current !== requestId || latestQueryRef.current.trim() !== requestQuery) {
        return
      }
      setSearchMode('llm')
      setSearchResults([])
      setSearchError(error.message || 'AI search failed.')
    } finally {
      if (aiRequestIdRef.current === requestId) {
        setLlmLoading(false)
      }
    }
  }

  return {
    hasSearchQuery,
    searchQuery,
    setSearchQuery,
    searchResults,
    searchMode,
    searchLoading,
    llmLoading,
    searchError,
    runAiSearch
  }
}

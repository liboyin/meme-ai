import { useEffect, useMemo, useState } from 'react'

export default function useSearch({ refreshToken }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchMode, setSearchMode] = useState('gallery')
  const [searchLoading, setSearchLoading] = useState(false)
  const [llmLoading, setLlmLoading] = useState(false)
  const [searchError, setSearchError] = useState('')

  const hasSearchQuery = useMemo(() => searchQuery.trim().length > 0, [searchQuery])

  useEffect(() => {
    if (!hasSearchQuery) {
      setSearchResults([])
      setSearchMode('gallery')
      setSearchLoading(false)
      setSearchError('')
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
  }, [hasSearchQuery, refreshToken, searchQuery])

  async function runAiSearch() {
    if (!hasSearchQuery) {
      return
    }

    try {
      setLlmLoading(true)
      setSearchError('')
      const response = await fetch('/api/search/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, top_n: 20 })
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error?.message || data?.detail || 'AI search failed.')
      }
      setSearchMode('llm')
      setSearchResults(data.items || [])
    } catch (error) {
      setSearchMode('llm')
      setSearchResults([])
      setSearchError(error.message || 'AI search failed.')
    } finally {
      setLlmLoading(false)
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

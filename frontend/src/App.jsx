import { useEffect, useRef, useState } from 'react'
import axios from 'axios'

const PAGE_SIZE = 40
const POLL_INTERVAL_MS = 3000

export default function App() {
  const [memes, setMemes] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [collectionError, setCollectionError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchMode, setSearchMode] = useState('gallery')
  const [searchLoading, setSearchLoading] = useState(false)
  const [llmLoading, setLlmLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [detailId, setDetailId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadMessage, setUploadMessage] = useState('')
  const [uploadErrors, setUploadErrors] = useState([])
  const [pendingItems, setPendingItems] = useState([])
  const [pollingActive, setPollingActive] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const pendingSnapshotRef = useRef('')

  const hasSearchQuery = searchQuery.trim().length > 0
  const shownMemes = hasSearchQuery ? searchResults : memes
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pendingCount = pendingItems.filter((item) => item.analysis_status === 'pending').length

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
  }, [detailId, refreshToken])

  useEffect(() => {
    let cancelled = false

    async function primePendingStatus() {
      try {
        const response = await fetch('/api/memes/pending')
        const data = await response.json()
        if (!response.ok || cancelled) {
          return
        }
        const items = data.items || []
        pendingSnapshotRef.current = JSON.stringify(items)
        setPendingItems(items)
        if (items.some((item) => item.analysis_status === 'pending')) {
          setPollingActive(true)
        }
      } catch {
        if (!cancelled) {
          setPendingItems([])
        }
      }
    }

    primePendingStatus()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!pollingActive) {
      return undefined
    }

    let cancelled = false

    async function pollPendingStatus() {
      try {
        const response = await fetch('/api/memes/pending')
        const data = await response.json()
        if (!response.ok || cancelled) {
          throw new Error('Polling failed.')
        }

        const items = data.items || []
        const snapshot = JSON.stringify(items)
        setPendingItems(items)

        if (snapshot !== pendingSnapshotRef.current) {
          pendingSnapshotRef.current = snapshot
          setRefreshToken((value) => value + 1)
        }

        if (!items.some((item) => item.analysis_status === 'pending')) {
          setPollingActive(false)
        }
      } catch {
        if (!cancelled) {
          setPollingActive(false)
        }
      }
    }

    pollPendingStatus()
    const intervalId = window.setInterval(pollPendingStatus, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [pollingActive])

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

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) {
      return
    }

    const formData = new FormData()
    files.forEach((file) => formData.append('files', file))

    try {
      setUploadProgress(0)
      setUploadMessage(`Uploading ${files.length} meme${files.length === 1 ? '' : 's'}...`)
      setUploadErrors([])

      const response = await axios.post('/api/memes/upload', formData, {
        onUploadProgress: (event) => {
          const nextProgress = event.total
            ? Math.round((event.loaded / event.total) * 100)
            : 0
          setUploadProgress(nextProgress)
        }
      })

      const items = response.data?.items || []
      const created = items.filter((item) => item.status === 'created')
      const errors = items
        .filter((item) => item.status === 'error')
        .map((item) => `${item.filename}: ${item.error}`)

      setUploadErrors(errors)
      setUploadProgress(created.length ? 100 : 0)

      if (created.length) {
        setPage(1)
        setPollingActive(true)
        setPendingItems(
          created.map((item) => ({
            id: item.id,
            analysis_status: 'pending'
          }))
        )
        setUploadMessage(
          `${created.length} meme${created.length === 1 ? '' : 's'} uploaded. Analysis is running in the background.`
        )
        setRefreshToken((value) => value + 1)
      } else {
        setUploadMessage('No files were uploaded.')
      }
    } catch (error) {
      const message =
        error.response?.data?.error?.message ||
        error.response?.data?.detail ||
        'Upload failed.'
      setUploadMessage(message)
      setUploadErrors([message])
      setUploadProgress(0)
    }
  }

  function openDetail(meme) {
    setDetailId(meme.id)
    setDetail(meme)
    setDetailError('')
  }

  function closeDetail() {
    setDetailId(null)
    setDetail(null)
    setDetailError('')
  }

  async function deleteMeme(id) {
    try {
      const response = await fetch(`/api/memes/${id}`, { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data?.detail || 'Delete failed.')
      }
      setPendingItems((current) => current.filter((item) => item.id !== id))
      closeDetail()
      setRefreshToken((value) => value + 1)
    } catch (error) {
      setDetailError(error.message || 'Delete failed.')
    }
  }

  function handleDrop(event) {
    event.preventDefault()
    setIsDragging(false)
    uploadFiles(event.dataTransfer.files)
  }

  return (
    <div className="shell">
      <div className="backdrop" />
      <div className="layout">
        <aside className="sidebar">
          <div className="hero">
            <p className="eyebrow">Local-first archive</p>
            <h1>Meme Organiser</h1>
            <p className="lede">
              Search thousands of reaction images without leaving your own machine.
            </p>
          </div>

          <section className="panel">
            <label className="fieldLabel" htmlFor="search">
              Search
            </label>
            <input
              id="search"
              className="searchInput"
              placeholder="Describe the vibe, joke, or situation"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <p className="helperText">
              Fuzzy search is instant. AI search reranks the shortlist when wording gets tricky.
            </p>
            {hasSearchQuery && (
              <button className="secondaryButton" onClick={runAiSearch} disabled={llmLoading}>
                {llmLoading ? 'AI search is scoring matches...' : 'Not finding it? Try AI search'}
              </button>
            )}
            {searchLoading && <p className="statusText">Refreshing fuzzy matches...</p>}
            {searchError && <p className="errorText">{searchError}</p>}
          </section>

          <section
            className={`panel dropzone ${isDragging ? 'isDragging' : ''}`}
            onDragEnter={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              setIsDragging(false)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDrop={handleDrop}
          >
            <div>
              <p className="dropTitle">Upload static memes</p>
              <p className="helperText">
                Drag in PNG, JPEG, or WEBP files, or pick up to 50 at once.
              </p>
            </div>
            <label className="primaryButton">
              Choose files
              <input
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  uploadFiles(event.target.files)
                  event.target.value = ''
                }}
              />
            </label>
            <div className="progressMeter" aria-label="Upload progress">
              <div style={{ width: `${uploadProgress}%` }} />
            </div>
            {uploadMessage && <p className="statusText">{uploadMessage}</p>}
            {!!uploadErrors.length && (
              <div className="messageBlock">
                {uploadErrors.map((message) => (
                  <p key={message} className="errorText">
                    {message}
                  </p>
                ))}
              </div>
            )}
          </section>

          <section className="panel statsPanel">
            <div>
              <p className="statLabel">Library size</p>
              <p className="statValue">{total}</p>
            </div>
            <div>
              <p className="statLabel">Pending analysis</p>
              <p className="statValue">{pendingCount}</p>
            </div>
            <div>
              <p className="statLabel">View</p>
              <p className="statValue">
                {hasSearchQuery ? (searchMode === 'llm' ? 'AI results' : 'Fuzzy results') : 'Gallery'}
              </p>
            </div>
          </section>
        </aside>

        <main className="content">
          <div className="toolbar">
            <div>
              <h2>{hasSearchQuery ? 'Search results' : 'Newest memes'}</h2>
              <p className="helperText">
                {hasSearchQuery
                  ? `${searchResults.length} result${searchResults.length === 1 ? '' : 's'} for "${searchQuery.trim()}".`
                  : `${memes.length} meme${memes.length === 1 ? '' : 's'} on this page.`}
              </p>
            </div>
            {pendingCount > 0 && (
              <div className="pendingBanner">
                <span className="pulse" />
                {pendingCount} meme{pendingCount === 1 ? '' : 's'} still being analysed
              </div>
            )}
          </div>

          {collectionError && <p className="errorText">{collectionError}</p>}

          {!shownMemes.length && !searchLoading ? (
            <div className="emptyState">
              <h3>{hasSearchQuery ? 'No matches yet' : 'Your meme vault is empty'}</h3>
              <p>
                {hasSearchQuery
                  ? 'Try different wording, shorter phrases, or the AI reranker.'
                  : 'Start by uploading the sample memes from assets/ or your own collection.'}
              </p>
            </div>
          ) : (
            <div className="grid">
              {shownMemes.map((meme) => (
                <button
                  key={meme.id}
                  className="card"
                  type="button"
                  onClick={() => openDetail(meme)}
                >
                  <img
                    src={`/api/memes/${meme.id}/image`}
                    alt={meme.filename}
                    className="cardImage"
                    loading="lazy"
                  />
                  <div className="cardBody">
                    <div className="cardHeader">
                      <strong>{meme.filename}</strong>
                      <span className={`statusBadge ${meme.analysis_status}`}>
                        {meme.analysis_status}
                      </span>
                    </div>
                    <p className="cardCopy">
                      {meme.description || 'Waiting for analysis to finish.'}
                    </p>
                    <div className="tagRow">
                      {(meme.tags || []).slice(0, 4).map((tag) => (
                        <span key={tag} className="tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {!hasSearchQuery && (
            <div className="pager">
              <button
                className="secondaryButton"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
              >
                Previous
              </button>
              <span className="pageLabel">
                Page {page} of {totalPages}
              </span>
              <button
                className="secondaryButton"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages}
              >
                Next
              </button>
            </div>
          )}
        </main>
      </div>

      {detailId !== null && (
        <div className="modal" onClick={closeDetail}>
          <div className="modalCard" onClick={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <p className="eyebrow">Meme detail</p>
                <h3>{detail?.filename || 'Loading...'}</h3>
              </div>
              <button className="closeButton" onClick={closeDetail}>
                Close
              </button>
            </div>
            <div className="modalBody">
              <img
                src={`/api/memes/${detailId}/image`}
                alt={detail?.filename || 'Selected meme'}
                className="detailImage"
              />
              <div className="detailMeta">
                <div className="detailRow">
                  <span className={`statusBadge ${detail?.analysis_status || 'pending'}`}>
                    {detail?.analysis_status || 'pending'}
                  </span>
                  <span className="metaText">{detail?.mime_type || 'Loading metadata...'}</span>
                </div>
                {detailLoading && <p className="statusText">Refreshing details...</p>}
                {detailError && <p className="errorText">{detailError}</p>}
                {detail?.analysis_status === 'error' && detail?.analysis_error && (
                  <p className="errorText">{detail.analysis_error}</p>
                )}
                <div className="detailBlock">
                  <h4>Description</h4>
                  <p>{detail?.description || 'No description yet.'}</p>
                </div>
                <div className="detailBlock">
                  <h4>Why it is funny</h4>
                  <p>{detail?.why_funny || 'No explanation yet.'}</p>
                </div>
                <div className="detailBlock">
                  <h4>References</h4>
                  <p>{detail?.references || 'No references noted yet.'}</p>
                </div>
                <div className="detailBlock">
                  <h4>Use cases</h4>
                  <p>{detail?.use_cases || 'No suggested use cases yet.'}</p>
                </div>
                <div className="detailBlock">
                  <h4>Tags</h4>
                  <div className="tagRow">
                    {(detail?.tags || []).map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                    {!detail?.tags?.length && <p>No tags yet.</p>}
                  </div>
                </div>
                <button
                  className="dangerButton"
                  onClick={() => deleteMeme(detailId)}
                >
                  Delete meme
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

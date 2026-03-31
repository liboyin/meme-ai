import { useEffect, useMemo, useState } from 'react'
import Sidebar from './components/Sidebar'
import MemeGrid from './components/MemeGrid'
import MemeDetailModal from './components/MemeDetailModal'
import useMemesCollection from './hooks/useMemesCollection'
import usePendingPolling from './hooks/usePendingPolling'
import useSearch from './hooks/useSearch'
import useUpload from './hooks/useUpload'

export default function App() {
  const {
    memes,
    page,
    setPage,
    total,
    totalPages,
    collectionError,
    refreshToken,
    refreshCollection,
    sortOption,
    sortLabel,
    sortOptions,
    setSortOption
  } = useMemesCollection()

  const {
    pendingCount,
    bootstrapPending,
    removePendingById
  } = usePendingPolling({ onPendingChanged: refreshCollection })

  const {
    hasSearchQuery,
    searchQuery,
    setSearchQuery,
    searchResults,
    searchMode,
    searchLoading,
    llmLoading,
    searchError,
    runAiSearch
  } = useSearch()

  const {
    uploadProgress,
    uploadMessage,
    uploadErrors,
    uploadFiles
  } = useUpload({
    onCreated: (created) => {
      setPage(1)
      bootstrapPending(
        created.map((item) => ({
          id: item.id,
          analysis_status: 'pending'
        }))
      )
      refreshCollection()
    }
  })

  const [detailId, setDetailId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailSaving, setDetailSaving] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [isDragging, setIsDragging] = useState(false)

  const shownMemes = useMemo(
    () => (hasSearchQuery ? searchResults : memes),
    [hasSearchQuery, memes, searchResults]
  )

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

  function handleDrop(event) {
    event.preventDefault()
    setIsDragging(false)
    uploadFiles(event.dataTransfer.files)
  }

  return (
    <div className="shell">
      <div className="backdrop" />
      <div className="layout">
        <Sidebar
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          hasSearchQuery={hasSearchQuery}
          llmLoading={llmLoading}
          onRunAiSearch={runAiSearch}
          searchLoading={searchLoading}
          searchError={searchError}
          isDragging={isDragging}
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
          onChooseFiles={uploadFiles}
          uploadProgress={uploadProgress}
          uploadMessage={uploadMessage}
          uploadErrors={uploadErrors}
          total={total}
          pendingCount={pendingCount}
          searchMode={searchMode}
        />

        <MemeGrid
          hasSearchQuery={hasSearchQuery}
          searchResults={searchResults}
          searchQuery={searchQuery}
          memes={memes}
          pendingCount={pendingCount}
          collectionError={collectionError}
          shownMemes={shownMemes}
          searchLoading={searchLoading}
          page={page}
          totalPages={totalPages}
          sortOption={sortOption}
          sortLabel={sortLabel}
          sortOptions={sortOptions}
          onSortChange={setSortOption}
          onPreviousPage={() => setPage((current) => Math.max(1, current - 1))}
          onNextPage={() => setPage((current) => Math.min(totalPages, current + 1))}
          onOpenDetail={openDetail}
        />
      </div>

      <MemeDetailModal
        detailId={detailId}
        detail={detail}
        detailLoading={detailLoading}
        detailSaving={detailSaving}
        detailError={detailError}
        onClose={closeDetail}
        onSave={saveMemeDetails}
        onDelete={deleteMeme}
      />
    </div>
  )
}

import { useMemo, useState } from 'react'
import Sidebar from './components/Sidebar'
import MemeGrid from './components/MemeGrid'
import MemeDetailModal from './components/MemeDetailModal'
import useDetailModal from './hooks/useDetailModal'
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

  const {
    detailId,
    detail,
    detailLoading,
    detailSaving,
    detailError,
    openDetail,
    closeDetail,
    saveMemeDetails,
    deleteMeme
  } = useDetailModal({ removePendingById, refreshCollection })

  const [isDragging, setIsDragging] = useState(false)

  const shownMemes = useMemo(
    () => (hasSearchQuery ? searchResults : memes),
    [hasSearchQuery, memes, searchResults]
  )

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

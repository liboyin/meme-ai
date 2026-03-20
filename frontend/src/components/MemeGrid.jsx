export default function MemeGrid({
  hasSearchQuery,
  searchResults,
  searchQuery,
  memes,
  pendingCount,
  collectionError,
  shownMemes,
  searchLoading,
  page,
  totalPages,
  onPreviousPage,
  onNextPage,
  onOpenDetail
}) {
  return (
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
              onClick={() => onOpenDetail(meme)}
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
            onClick={onPreviousPage}
            disabled={page <= 1}
          >
            Previous
          </button>
          <span className="pageLabel">
            Page {page} of {totalPages}
          </span>
          <button
            className="secondaryButton"
            onClick={onNextPage}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </div>
      )}
    </main>
  )
}

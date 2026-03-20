export default function Sidebar({
  searchQuery,
  onSearchQueryChange,
  hasSearchQuery,
  llmLoading,
  onRunAiSearch,
  searchLoading,
  searchError,
  isDragging,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onChooseFiles,
  uploadProgress,
  uploadMessage,
  uploadErrors,
  total,
  pendingCount,
  searchMode
}) {
  return (
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
          onChange={(event) => onSearchQueryChange(event.target.value)}
        />
        <p className="helperText">
          Fuzzy search is instant. AI search reranks the shortlist when wording gets tricky.
        </p>
        {hasSearchQuery && (
          <button className="secondaryButton" onClick={onRunAiSearch} disabled={llmLoading}>
            {llmLoading ? 'AI search is scoring matches...' : 'Not finding it? Try AI search'}
          </button>
        )}
        {searchLoading && <p className="statusText">Refreshing fuzzy matches...</p>}
        {searchError && <p className="errorText">{searchError}</p>}
      </section>

      <section
        className={`panel dropzone ${isDragging ? 'isDragging' : ''}`}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
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
              onChooseFiles(event.target.files)
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
  )
}

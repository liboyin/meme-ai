export default function MemeDetailModal({
  detailId,
  detail,
  detailLoading,
  detailError,
  onClose,
  onDelete
}) {
  if (detailId === null) {
    return null
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="modalCard" onClick={(event) => event.stopPropagation()}>
        <div className="modalHeader">
          <div>
            <p className="eyebrow">Meme detail</p>
            <h3>{detail?.filename || 'Loading...'}</h3>
          </div>
          <button className="closeButton" onClick={onClose}>
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
              onClick={() => onDelete(detailId)}
            >
              Delete meme
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

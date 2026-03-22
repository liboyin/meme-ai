import { useEffect, useState } from 'react'

function buildFormState(detail) {
  return {
    description: detail?.description || '',
    why_funny: detail?.why_funny || '',
    references: detail?.references || '',
    use_cases: detail?.use_cases || '',
    tags: (detail?.tags || []).join(', ')
  }
}

function parseTags(value) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

export default function MemeDetailModal({
  detailId,
  detail,
  detailLoading,
  detailSaving,
  detailError,
  onClose,
  onSave,
  onDelete
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [form, setForm] = useState(buildFormState(detail))

  useEffect(() => {
    setIsEditing(false)
    setForm(buildFormState(detail))
  }, [detailId])

  useEffect(() => {
    if (!isEditing) {
      setForm(buildFormState(detail))
    }
  }, [detail, isEditing])

  if (detailId === null) {
    return null
  }

  async function handleSubmit(event) {
    event.preventDefault()
    try {
      await onSave({
        description: form.description.trim() || null,
        why_funny: form.why_funny.trim() || null,
        references: form.references.trim() || null,
        use_cases: form.use_cases.trim() || null,
        tags: parseTags(form.tags)
      })
      setIsEditing(false)
    } catch {
      // The parent renders the error message and keeps the draft intact.
    }
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
            <form className="detailForm" onSubmit={handleSubmit}>
              <div className="detailBlock">
                <div className="detailRow">
                  <h4>Description</h4>
                  {!isEditing ? (
                    <button
                      className="secondaryButton"
                      type="button"
                      onClick={() => setIsEditing(true)}
                    >
                      Edit fields
                    </button>
                  ) : null}
                </div>
                {isEditing ? (
                  <label className="detailField">
                    <span className="fieldLabel">Description</span>
                    <textarea
                      className="searchInput detailTextarea"
                      value={form.description}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, description: event.target.value }))
                      }
                    />
                  </label>
                ) : (
                  <p>{detail?.description || 'No description yet.'}</p>
                )}
              </div>
              <div className="detailBlock">
                <h4>Why it is funny</h4>
                {isEditing ? (
                  <label className="detailField">
                    <span className="fieldLabel">Why it is funny</span>
                    <textarea
                      className="searchInput detailTextarea"
                      value={form.why_funny}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, why_funny: event.target.value }))
                      }
                    />
                  </label>
                ) : (
                  <p>{detail?.why_funny || 'No explanation yet.'}</p>
                )}
              </div>
              <div className="detailBlock">
                <h4>References</h4>
                {isEditing ? (
                  <label className="detailField">
                    <span className="fieldLabel">References</span>
                    <textarea
                      className="searchInput detailTextarea"
                      value={form.references}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, references: event.target.value }))
                      }
                    />
                  </label>
                ) : (
                  <p>{detail?.references || 'No references noted yet.'}</p>
                )}
              </div>
              <div className="detailBlock">
                <h4>Use cases</h4>
                {isEditing ? (
                  <label className="detailField">
                    <span className="fieldLabel">Use cases</span>
                    <textarea
                      className="searchInput detailTextarea"
                      value={form.use_cases}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, use_cases: event.target.value }))
                      }
                    />
                  </label>
                ) : (
                  <p>{detail?.use_cases || 'No suggested use cases yet.'}</p>
                )}
              </div>
              <div className="detailBlock">
                <h4>Tags</h4>
                {isEditing ? (
                  <label className="detailField">
                    <span className="fieldLabel">Comma-separated tags</span>
                    <input
                      className="searchInput"
                      value={form.tags}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, tags: event.target.value }))
                      }
                    />
                  </label>
                ) : (
                  <div className="tagRow">
                    {(detail?.tags || []).map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                    {!detail?.tags?.length && <p>No tags yet.</p>}
                  </div>
                )}
              </div>
              {isEditing ? (
                <div className="detailActions">
                  <button
                    className="secondaryButton"
                    type="button"
                    onClick={() => {
                      setForm(buildFormState(detail))
                      setIsEditing(false)
                    }}
                    disabled={detailSaving}
                  >
                    Cancel changes
                  </button>
                  <button className="primaryButton" type="submit" disabled={detailSaving}>
                    {detailSaving ? 'Saving...' : 'Save metadata'}
                  </button>
                </div>
              ) : null}
            </form>
            <button
              className="dangerButton"
              onClick={() => onDelete(detailId)}
              disabled={detailSaving}
            >
              Delete meme
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'

const PAGE_SIZE = 40

export default function App() {
  const [memes, setMemes] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState(null)
  const [progress, setProgress] = useState(0)
  const [llmLoading, setLlmLoading] = useState(false)

  const loadMemes = async (p = page) => {
    const res = await fetch(`/api/memes?page=${p}&page_size=${PAGE_SIZE}`)
    const data = await res.json()
    setMemes(data.items)
    setTotal(data.total)
  }

  useEffect(() => { loadMemes(1) }, [])

  useEffect(() => {
    if (!searchQuery.trim()) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&mode=fuzzy`)
      const data = await res.json()
      setResults(data.items || [])
    }, 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    const i = setInterval(async () => {
      const res = await fetch('/api/memes/pending')
      const data = await res.json()
      const hasPending = (data.items || []).some((x) => x.analysis_status === 'pending')
      if (hasPending) {
        loadMemes(page)
      }
    }, 3000)
    return () => clearInterval(i)
  }, [page])

  const shown = useMemo(() => (results.length ? results : memes), [results, memes])

  const onUpload = async (files) => {
    const form = new FormData()
    Array.from(files).forEach((f) => form.append('files', f))
    await axios.post('/api/memes/upload', form, {
      onUploadProgress: (evt) => {
        const p = evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0
        setProgress(p)
      }
    })
    setProgress(100)
    await loadMemes(1)
  }

  const runLlmSearch = async () => {
    setLlmLoading(true)
    const res = await fetch('/api/search/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: searchQuery, top_n: 20 })
    })
    const data = await res.json()
    setResults(data.items || [])
    setLlmLoading(false)
  }

  const deleteMeme = async (id) => {
    await fetch(`/api/memes/${id}`, { method: 'DELETE' })
    setSelected(null)
    loadMemes(page)
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Meme Organiser</h1>
        <input placeholder="Search memes" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        {searchQuery && <button onClick={runLlmSearch} disabled={llmLoading}>{llmLoading ? 'AI searching...' : 'Not finding it? Try AI search'}</button>}
        <label className="dropzone">
          Upload memes
          <input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(e) => onUpload(e.target.files)} />
        </label>
        <div className="progress"><div style={{ width: `${progress}%` }} /></div>
      </aside>
      <main>
        <div className="grid">
          {shown.map((m) => (
            <button key={m.id} className="card" onClick={() => setSelected(m)}>
              <img src={`/api/memes/${m.id}/image`} alt={m.filename} loading="lazy" />
              <div>{m.filename}</div>
              <div className={`status ${m.analysis_status}`}>{m.analysis_status}</div>
              <div>{(m.tags || []).join(', ')}</div>
            </button>
          ))}
        </div>
        {!results.length && <div className="pager">
          <button disabled={page <= 1} onClick={() => { setPage(page - 1); loadMemes(page - 1) }}>Prev</button>
          <span>{page} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
          <button disabled={page >= Math.ceil(total / PAGE_SIZE)} onClick={() => { setPage(page + 1); loadMemes(page + 1) }}>Next</button>
        </div>}
      </main>
      {selected && <div className="modal" onClick={() => setSelected(null)}>
        <div className="modalContent" onClick={(e) => e.stopPropagation()}>
          <img src={`/api/memes/${selected.id}/image`} alt="full" />
          <p><strong>Description:</strong> {selected.description}</p>
          <p><strong>Why funny:</strong> {selected.why_funny}</p>
          <p><strong>References:</strong> {selected.references}</p>
          <p><strong>Use cases:</strong> {selected.use_cases}</p>
          {selected.analysis_status === 'error' && <p className="error">{selected.analysis_error}</p>}
          <button onClick={() => deleteMeme(selected.id)}>Delete</button>
        </div>
      </div>}
    </div>
  )
}

import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react'
import axios from 'axios'
import App from '../src/App'

vi.mock('axios', () => ({
  default: {
    post: vi.fn()
  }
}))

function makeResponse(data, ok = true) {
  return {
    ok,
    json: vi.fn(async () => data)
  }
}

function deferred() {
  let resolve
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function installFetchMock(routes) {
  const queues = Object.fromEntries(
    Object.entries(routes).map(([key, value]) => [key, Array.isArray(value) ? [...value] : [value]])
  )

  global.fetch = vi.fn(async (input, options = {}) => {
    const url = String(input)

    if (url.startsWith('/api/memes?')) {
      return consume('list', url, options)
    }
    if (url === '/api/memes/pending') {
      return consume('pending', url, options)
    }
    if (url.startsWith('/api/search?q=')) {
      return consume('search', url, options)
    }
    if (url === '/api/search/llm') {
      return consume('searchLlm', url, options)
    }
    if (/^\/api\/memes\/\d+$/.test(url) && options.method === 'DELETE') {
      return consume('delete', url, options)
    }
    if (/^\/api\/memes\/\d+$/.test(url)) {
      return consume('detail', url, options)
    }

    throw new Error(`Unhandled fetch URL: ${url}`)
  })

  function consume(key, url, options) {
    const queue = queues[key] || [makeResponse({})]
    const next = queue.length > 1 ? queue.shift() : queue[0]
    queues[key] = queue
    if (typeof next === 'function') {
      return next(url, options)
    }
    return next
  }
}

async function advanceTimers(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useRealTimers()
  axios.post.mockReset()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('App', () => {
  it('renders the empty gallery state', async () => {
    installFetchMock({
      list: makeResponse({ items: [], total: 0 }),
      pending: makeResponse({ items: [] })
    })

    render(createElement(App))

    expect(await screen.findByText('Meme Organiser')).toBeTruthy()
    expect(await screen.findByText('Your meme vault is empty')).toBeTruthy()
  })

  it('shows a collection error when the gallery load fails', async () => {
    installFetchMock({
      list: makeResponse({ detail: 'boom' }, false),
      pending: makeResponse({ items: [] })
    })

    render(createElement(App))

    expect(await screen.findByText('Could not load memes.')).toBeTruthy()
  })

  it('paginates through gallery pages', async () => {
    installFetchMock({
      list: [
        makeResponse({
          items: [{ id: 1, filename: 'page-one.png', description: 'first', analysis_status: 'done', tags: [] }],
          total: 80
        }),
        makeResponse({
          items: [{ id: 2, filename: 'page-two.png', description: 'second', analysis_status: 'done', tags: [] }],
          total: 80
        }),
        makeResponse({
          items: [{ id: 1, filename: 'page-one.png', description: 'first', analysis_status: 'done', tags: [] }],
          total: 80
        })
      ],
      pending: makeResponse({ items: [] })
    })

    render(createElement(App))

    expect(await screen.findByText('page-one.png')).toBeTruthy()
    fireEvent.click(screen.getByText('Next'))
    expect(await screen.findByText('page-two.png')).toBeTruthy()
    fireEvent.click(screen.getByText('Previous'))
    expect(await screen.findByText('page-one.png')).toBeTruthy()
  })

  it('opens a detail modal and deletes a meme', async () => {
    installFetchMock({
      list: [
        makeResponse({
          items: [{ id: 10, filename: 'focus.png', description: 'preview', analysis_status: 'done', tags: ['focus'] }],
          total: 1
        }),
        makeResponse({ items: [], total: 0 })
      ],
      pending: makeResponse({ items: [] }),
      detail: makeResponse({
        id: 10,
        filename: 'focus.png',
        mime_type: 'image/png',
        description: 'full detail',
        why_funny: 'relatable panic',
        references: 'internet forum energy',
        use_cases: 'deadline jokes',
        tags: ['focus'],
        analysis_status: 'done',
        analysis_error: null
      }),
      delete: makeResponse({ deleted: true })
    })

    render(createElement(App))

    fireEvent.click(await screen.findByText('focus.png'))
    expect(await screen.findByText('full detail')).toBeTruthy()

    fireEvent.click(screen.getByText('Delete meme'))
    expect(await screen.findByText('Your meme vault is empty')).toBeTruthy()
  })

  it('shows detail and delete errors when those requests fail', async () => {
    installFetchMock({
      list: makeResponse({
        items: [{ id: 11, filename: 'broken.png', description: 'preview', analysis_status: 'done', tags: [] }],
        total: 1
      }),
      pending: makeResponse({ items: [] }),
      detail: makeResponse({ detail: 'Could not load meme details.' }, false),
      delete: makeResponse({ detail: 'Delete blocked.' }, false)
    })

    render(createElement(App))

    fireEvent.click(await screen.findByText('broken.png'))
    expect(await screen.findByText('Could not load meme details.')).toBeTruthy()

    fireEvent.click(screen.getByText('Delete meme'))
    expect(await screen.findByText('Delete blocked.')).toBeTruthy()
  })

  it('shows analysis errors returned by meme details', async () => {
    installFetchMock({
      list: makeResponse({
        items: [{ id: 12, filename: 'analysis-error.png', description: 'preview', analysis_status: 'error', tags: [] }],
        total: 1
      }),
      pending: makeResponse({ items: [] }),
      detail: makeResponse({
        id: 12,
        filename: 'analysis-error.png',
        mime_type: 'image/png',
        description: '',
        why_funny: '',
        references: '',
        use_cases: '',
        tags: [],
        analysis_status: 'error',
        analysis_error: 'Model response could not be parsed.'
      })
    })

    render(createElement(App))

    fireEvent.click(await screen.findByText('analysis-error.png'))
    expect(await screen.findByText('Model response could not be parsed.')).toBeTruthy()
  })

  it('runs fuzzy search and AI search', async () => {
    vi.useFakeTimers()
    const fuzzySearch = deferred()
    const aiSearch = deferred()

    installFetchMock({
      list: makeResponse({ items: [], total: 0 }),
      pending: makeResponse({ items: [] }),
      search: () => fuzzySearch.promise,
      searchLlm: () => aiSearch.promise
    })

    render(createElement(App))

    fireEvent.change(screen.getByPlaceholderText('Describe the vibe, joke, or situation'), {
      target: { value: 'dramatic' }
    })

    await advanceTimers(300)
    expect(screen.getByText('Refreshing fuzzy matches...')).toBeTruthy()

    fuzzySearch.resolve(
      makeResponse({
        items: [{ id: 21, filename: 'fuzzy.png', description: 'fuzzy match', analysis_status: 'done', tags: ['fuzzy'] }]
      })
    )
    await flushMicrotasks()

    expect(screen.getByText('fuzzy.png')).toBeTruthy()
    expect(screen.getByText('Fuzzy results')).toBeTruthy()

    fireEvent.click(screen.getByText('Not finding it? Try AI search'))
    expect(screen.getByText('AI search is scoring matches...')).toBeTruthy()

    aiSearch.resolve(
      makeResponse({
        items: [{ id: 22, filename: 'ai.png', description: 'ai match', analysis_status: 'done', tags: ['ai'] }]
      })
    )
    await flushMicrotasks()

    expect(screen.getByText('ai.png')).toBeTruthy()
    expect(screen.getByText('AI results')).toBeTruthy()
  }, 10000)

  it('shows fuzzy and AI search errors', async () => {
    vi.useFakeTimers()

    installFetchMock({
      list: makeResponse({ items: [], total: 0 }),
      pending: makeResponse({ items: [] }),
      search: makeResponse({ detail: 'Search is unavailable.' }, false),
      searchLlm: makeResponse({ error: { message: 'LLM search is unavailable.' } }, false)
    })

    render(createElement(App))

    fireEvent.change(screen.getByPlaceholderText('Describe the vibe, joke, or situation'), {
      target: { value: 'chaos' }
    })
    await advanceTimers(300)

    expect(screen.getByText('Search is unavailable.')).toBeTruthy()
    expect(screen.getByText('No matches yet')).toBeTruthy()

    fireEvent.click(screen.getByText('Not finding it? Try AI search'))
    await flushMicrotasks()
    expect(screen.getByText('LLM search is unavailable.')).toBeTruthy()
  }, 10000)

  it('uploads files with progress, partial errors, and polling refresh', async () => {
    vi.useFakeTimers()

    installFetchMock({
      list: [
        makeResponse({ items: [], total: 0 }),
        makeResponse({
          items: [{ id: 31, filename: 'upload.png', description: '', analysis_status: 'pending', tags: [] }],
          total: 1
        }),
        makeResponse({
          items: [{ id: 31, filename: 'upload.png', description: 'done', analysis_status: 'done', tags: ['fresh'] }],
          total: 1
        })
      ],
      pending: [
        makeResponse({ items: [] }),
        makeResponse({ items: [{ id: 31, analysis_status: 'pending' }] }),
        makeResponse({ items: [{ id: 31, analysis_status: 'done' }] })
      ]
    })

    axios.post.mockImplementation(async (_url, _data, options) => {
      options.onUploadProgress({ loaded: 2, total: 4 })
      return {
        data: {
          items: [
            { status: 'created', id: 31, filename: 'upload.png' },
            { status: 'error', filename: 'bad.gif', error: 'Unsupported file type' }
          ]
        }
      }
    })

    render(createElement(App))

    const dropzone = screen.getByText('Upload static memes').closest('section')
    fireEvent.dragEnter(dropzone)
    expect(dropzone.className).toContain('isDragging')
    fireEvent.dragOver(dropzone)
    expect(dropzone.className).toContain('isDragging')
    fireEvent.dragLeave(dropzone)
    expect(dropzone.className).not.toContain('isDragging')
    fireEvent.dragEnter(dropzone)

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [
          new File(['a'], 'upload.png', { type: 'image/png' }),
          new File(['b'], 'bad.gif', { type: 'image/gif' })
        ]
      }
    })

    await flushMicrotasks()
    expect(screen.getByText('1 meme uploaded. Analysis is running in the background.')).toBeTruthy()
    expect(screen.getByText('bad.gif: Unsupported file type')).toBeTruthy()
    expect(screen.getByText(/still being analysed/)).toBeTruthy()
    expect(screen.getByLabelText('Upload progress').firstElementChild.style.width).toBe('100%')

    await advanceTimers(3000)
    await flushMicrotasks()
    expect(screen.getByText('upload.png')).toBeTruthy()
  }, 10000)

  it('shows upload errors when the upload request fails', async () => {
    installFetchMock({
      list: makeResponse({ items: [], total: 0 }),
      pending: makeResponse({ items: [] })
    })

    axios.post.mockRejectedValue({
      response: {
        data: {
          detail: 'Upload exploded.'
        }
      }
    })

    render(createElement(App))

    const input = screen.getByLabelText('Choose files')
    fireEvent.change(input, {
      target: {
        files: [new File(['a'], 'boom.png', { type: 'image/png' })]
      }
    })

    expect((await screen.findAllByText('Upload exploded.')).length).toBe(2)
  })

  it('falls back to the default upload error message', async () => {
    installFetchMock({
      list: makeResponse({ items: [], total: 0 }),
      pending: makeResponse({ items: [] })
    })

    axios.post.mockRejectedValue(new Error('network boom'))

    render(createElement(App))

    const input = screen.getByLabelText('Choose files')
    fireEvent.change(input, {
      target: {
        files: [new File(['a'], 'boom.png', { type: 'image/png' })]
      }
    })

    expect((await screen.findAllByText('Upload failed.')).length).toBe(2)
  })

  it('ignores empty file selections', async () => {
    installFetchMock({
      list: makeResponse({ items: [], total: 0 }),
      pending: makeResponse({ items: [] })
    })

    render(createElement(App))

    const input = screen.getByLabelText('Choose files')
    fireEvent.change(input, {
      target: {
        files: []
      }
    })

    expect(axios.post).not.toHaveBeenCalled()
  })

  it('shows a no-created upload result when every file fails', async () => {
    installFetchMock({
      list: makeResponse({ items: [], total: 0 }),
      pending: makeResponse({ items: [] })
    })

    axios.post.mockImplementation(async (_url, _data, options) => {
      options.onUploadProgress({ loaded: 1 })
      return {
        data: {
          items: [
            { status: 'error', filename: 'bad.png', error: 'Unsupported file type' }
          ]
        }
      }
    })

    render(createElement(App))

    const input = screen.getByLabelText('Choose files')
    fireEvent.change(input, {
      target: {
        files: [new File(['a'], 'bad.png', { type: 'image/png' })]
      }
    })

    expect(await screen.findByText('No files were uploaded.')).toBeTruthy()
    expect(screen.getByText('bad.png: Unsupported file type')).toBeTruthy()
    expect(screen.getByLabelText('Upload progress').firstElementChild.style.width).toBe('0%')
  })

  it('stops polling when pending refresh fails', async () => {
    vi.useFakeTimers()

    installFetchMock({
      list: makeResponse({ items: [], total: 0 }),
      pending: [
        makeResponse({ items: [{ id: 77, analysis_status: 'pending' }] }),
        makeResponse({ detail: 'polling broke' }, false)
      ]
    })

    render(createElement(App))

    await flushMicrotasks()
    await flushMicrotasks()

    expect(global.fetch).toHaveBeenCalledWith('/api/memes/pending')
    expect(screen.getByText(/still being analysed/)).toBeTruthy()
  })
})

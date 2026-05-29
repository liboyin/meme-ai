import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import axios from 'axios'
import useDetailModal from '../src/hooks/useDetailModal'
import useMemesCollection from '../src/hooks/useMemesCollection'
import usePendingPolling from '../src/hooks/usePendingPolling'
import useSearch from '../src/hooks/useSearch'
import useUpload from '../src/hooks/useUpload'

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

beforeEach(() => {
  vi.useRealTimers()
  global.fetch = vi.fn()
  axios.post.mockReset()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('useMemesCollection', () => {
  it('resets pagination on sort changes and falls back to the default sort', async () => {
    global.fetch
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 1 }], total: 80 }))
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 2 }], total: 80 }))
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 3 }], total: 80 }))
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 4 }], total: 80 }))

    const { result } = renderHook(() => useMemesCollection())

    await waitFor(() => {
      expect(result.current.memes).toEqual([{ id: 1 }])
    })
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/memes?page=1&page_size=40&sort_by=uploaded_at&sort_order=desc'
    )

    act(() => {
      result.current.setPage(2)
    })
    await waitFor(() => {
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        '/api/memes?page=2&page_size=40&sort_by=uploaded_at&sort_order=desc'
      )
    })

    act(() => {
      result.current.setSortOption('filename_asc')
    })
    await waitFor(() => {
      expect(result.current.page).toBe(1)
      expect(global.fetch).toHaveBeenNthCalledWith(
        3,
        '/api/memes?page=1&page_size=40&sort_by=filename&sort_order=asc'
      )
    })

    act(() => {
      result.current.setSortOption('bogus')
    })
    await waitFor(() => {
      expect(global.fetch).toHaveBeenNthCalledWith(
        4,
        '/api/memes?page=1&page_size=40&sort_by=uploaded_at&sort_order=desc'
      )
    })
  })

  it('falls back to empty array and zero total when response has no items or total', async () => {
    global.fetch.mockResolvedValueOnce(makeResponse({}))

    const { result } = renderHook(() => useMemesCollection())

    await waitFor(() => {
      expect(result.current.memes).toEqual([])
    })
    expect(result.current.total).toBe(0)
  })

  it('sets collectionError when fetch responds with !ok', async () => {
    global.fetch.mockResolvedValueOnce(makeResponse({}, false))

    const { result } = renderHook(() => useMemesCollection())

    await waitFor(() => {
      expect(result.current.collectionError).toBe('Could not load memes.')
    })
  })

  it('ignores late collection responses after unmount', async () => {
    let resolveFetch
    global.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        })
    )

    const { unmount } = renderHook(() => useMemesCollection())

    unmount()

    await act(async () => {
      resolveFetch(makeResponse({ items: [{ id: 99 }], total: 1 }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('refreshCollection has a stable identity across re-renders', async () => {
    global.fetch.mockResolvedValue(makeResponse({ items: [], total: 0 }))

    const { result, rerender } = renderHook(() => useMemesCollection())

    await waitFor(() => {
      expect(result.current.memes).toEqual([])
    })

    const first = result.current.refreshCollection
    rerender()
    expect(result.current.refreshCollection).toBe(first)
  })
})

describe('useSearch', () => {
  it('skips AI search without a query and resets to gallery mode when cleared', async () => {
    vi.useFakeTimers()
    global.fetch
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 11 }] }))
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 12 }] }))
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 13 }] }))

    const { result } = renderHook(() => useSearch({ refreshToken: 0 }))

    await act(async () => {
      await result.current.runAiSearch()
    })
    expect(global.fetch).not.toHaveBeenCalled()

    act(() => {
      result.current.setSearchQuery('chaos')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.searchMode).toBe('fuzzy')
    expect(result.current.searchResults).toEqual([{ id: 11 }])

    act(() => {
      result.current.setSearchQuery('')
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.hasSearchQuery).toBe(false)
    expect(result.current.searchMode).toBe('gallery')
    expect(result.current.searchResults).toEqual([])

    act(() => {
      result.current.setSearchQuery('chaos')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.searchMode).toBe('fuzzy')
    expect(result.current.searchResults).toEqual([{ id: 12 }])

    await act(async () => {
      await result.current.runAiSearch()
      await Promise.resolve()
    })
    expect(result.current.searchMode).toBe('llm')
    expect(result.current.searchResults).toEqual([{ id: 13 }])
  })

  it('drops stale fuzzy responses after cleanup', async () => {
    vi.useFakeTimers()
    let resolveFetch
    global.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        })
    )

    const { result, unmount } = renderHook(() => useSearch({ refreshToken: 0 }))

    act(() => {
      result.current.setSearchQuery('stale')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    unmount()

    await act(async () => {
      resolveFetch(makeResponse({ items: [{ id: 77 }] }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('uses fallback message when fuzzy search response has no detail', async () => {
    vi.useFakeTimers()
    global.fetch.mockResolvedValueOnce(makeResponse({}, false))

    const { result } = renderHook(() => useSearch({ refreshToken: 0 }))

    act(() => { result.current.setSearchQuery('test') })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.searchError).toBe('Fuzzy search failed.')
    expect(result.current.searchResults).toEqual([])
  })

  it('falls back to empty array when fuzzy search returns no items field', async () => {
    vi.useFakeTimers()
    global.fetch.mockResolvedValueOnce(makeResponse({}))

    const { result } = renderHook(() => useSearch({ refreshToken: 0 }))

    act(() => { result.current.setSearchQuery('test') })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.searchMode).toBe('fuzzy')
    expect(result.current.searchResults).toEqual([])
  })

  it('uses fallback message when fuzzy search throws with no error.message', async () => {
    vi.useFakeTimers()
    global.fetch.mockRejectedValueOnce({})

    const { result } = renderHook(() => useSearch({ refreshToken: 0 }))

    act(() => { result.current.setSearchQuery('test') })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.searchError).toBe('Fuzzy search failed.')
  })

  it('uses data.detail fallback when AI search response has no error.message', async () => {
    vi.useFakeTimers()
    global.fetch
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 1 }] }))
      .mockResolvedValueOnce(makeResponse({ detail: 'LLM unavailable' }, false))

    const { result } = renderHook(() => useSearch({ refreshToken: 0 }))

    act(() => { result.current.setSearchQuery('cats') })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      await result.current.runAiSearch()
      await Promise.resolve()
    })

    expect(result.current.searchError).toBe('LLM unavailable')
    expect(result.current.searchMode).toBe('llm')
  })

  it('uses the hardcoded fallback when AI search response has no error info', async () => {
    vi.useFakeTimers()
    global.fetch
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 1 }] }))
      .mockResolvedValueOnce(makeResponse({}, false))

    const { result } = renderHook(() => useSearch({ refreshToken: 0 }))

    act(() => { result.current.setSearchQuery('cats') })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      await result.current.runAiSearch()
      await Promise.resolve()
    })

    expect(result.current.searchError).toBe('AI search failed.')
  })

  it('falls back to empty array when AI search returns no items field', async () => {
    vi.useFakeTimers()
    global.fetch
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 1 }] }))
      .mockResolvedValueOnce(makeResponse({}))

    const { result } = renderHook(() => useSearch({ refreshToken: 0 }))

    act(() => { result.current.setSearchQuery('cats') })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      await result.current.runAiSearch()
      await Promise.resolve()
    })

    expect(result.current.searchMode).toBe('llm')
    expect(result.current.searchResults).toEqual([])
  })

  it('uses fallback message when AI search throws with no error.message', async () => {
    vi.useFakeTimers()
    global.fetch
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 1 }] }))
      .mockRejectedValueOnce({})

    const { result } = renderHook(() => useSearch({ refreshToken: 0 }))

    act(() => { result.current.setSearchQuery('cats') })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      await result.current.runAiSearch()
      await Promise.resolve()
    })

    expect(result.current.searchError).toBe('AI search failed.')
    expect(result.current.searchMode).toBe('llm')
  })

  it('typing after AI search clears AI results and refreshes fuzzy results', async () => {
    vi.useFakeTimers()
    global.fetch
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 10 }] }))
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 20 }] }))
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 30 }] }))

    const { result } = renderHook(() => useSearch({ refreshToken: 0 }))

    act(() => { result.current.setSearchQuery('cats') })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.searchMode).toBe('fuzzy')

    await act(async () => {
      await result.current.runAiSearch()
      await Promise.resolve()
    })
    expect(result.current.searchMode).toBe('llm')
    expect(result.current.searchResults).toEqual([{ id: 20 }])

    act(() => { result.current.setSearchQuery('cats memes') })
    expect(result.current.searchResults).toEqual([])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(global.fetch).toHaveBeenCalledTimes(3)
    expect(result.current.searchMode).toBe('fuzzy')
    expect(result.current.searchResults).toEqual([{ id: 30 }])
  })

  it('ignores late AI responses after the query changes', async () => {
    vi.useFakeTimers()
    const aiSearch = deferred()

    global.fetch
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 1 }] }))
      .mockImplementationOnce(() => aiSearch.promise)
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 2 }] }))

    const { result } = renderHook(() => useSearch({ refreshToken: 0 }))

    act(() => { result.current.setSearchQuery('cats') })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
      await Promise.resolve()
    })

    let aiPromise
    await act(async () => {
      aiPromise = result.current.runAiSearch()
      await Promise.resolve()
    })

    act(() => { result.current.setSearchQuery('dogs') })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
      await Promise.resolve()
      await Promise.resolve()
    })

    aiSearch.resolve(makeResponse({ items: [{ id: 99 }] }))
    await act(async () => {
      await aiPromise
      await Promise.resolve()
    })

    expect(result.current.searchMode).toBe('fuzzy')
    expect(result.current.searchResults).toEqual([{ id: 2 }])
  })
})

describe('usePendingPolling', () => {
  it('keeps completed items without starting polling and supports helper updates', async () => {
    global.fetch.mockResolvedValueOnce(
      makeResponse({ items: [{ id: 91, analysis_status: 'done' }] })
    )

    const { result } = renderHook(() =>
      usePendingPolling({ onPendingChanged: vi.fn() })
    )

    await waitFor(() => {
      expect(result.current.pendingItems).toEqual([{ id: 91, analysis_status: 'done' }])
    })
    expect(result.current.pendingCount).toBe(0)
    expect(result.current.pollingActive).toBe(false)

    act(() => {
      result.current.bootstrapPending([{ id: 92, analysis_status: 'pending' }])
    })
    expect(result.current.pendingCount).toBe(1)
    expect(result.current.pollingActive).toBe(true)

    act(() => {
      result.current.removePendingById(92)
      result.current.setPollingActive(false)
    })
    expect(result.current.pendingItems).toEqual([])
    expect(result.current.pollingActive).toBe(false)
  })

  it('sets empty items when initial fetch throws', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() =>
      usePendingPolling({ onPendingChanged: vi.fn() })
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.pendingItems).toEqual([])
    expect(result.current.pollingActive).toBe(false)
  })

  it('polls when active, calls onPendingChanged when items change, stops when no pending items', async () => {
    vi.useFakeTimers()
    const onPendingChanged = vi.fn()

    global.fetch
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 1, analysis_status: 'pending' }] }))
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 1, analysis_status: 'done' }] }))

    const { result } = renderHook(() =>
      usePendingPolling({ onPendingChanged })
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.pollingActive).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onPendingChanged).toHaveBeenCalledTimes(1)
    expect(result.current.pendingItems).toEqual([{ id: 1, analysis_status: 'done' }])
    expect(result.current.pollingActive).toBe(false)
  })

  it('keeps polling active when the poll fetch throws with pending items known', async () => {
    vi.useFakeTimers()

    global.fetch
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 1, analysis_status: 'pending' }] }))
      .mockRejectedValueOnce(new Error('Poll network failure'))

    const { result } = renderHook(() =>
      usePendingPolling({ onPendingChanged: vi.fn() })
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.pollingActive).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.pollingActive).toBe(true)
  })

  it('keeps polling active when the poll response is not ok with pending items known', async () => {
    vi.useFakeTimers()

    global.fetch
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 1, analysis_status: 'pending' }] }))
      .mockResolvedValueOnce(makeResponse({ detail: 'Server error' }, false))

    const { result } = renderHook(() =>
      usePendingPolling({ onPendingChanged: vi.fn() })
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.pollingActive).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.pollingActive).toBe(true)
  })

  it('stable onPendingChanged identity does not restart the polling interval', async () => {
    vi.useFakeTimers()

    global.fetch
      .mockResolvedValueOnce(makeResponse({ items: [{ id: 1, analysis_status: 'pending' }] }))
      .mockResolvedValue(makeResponse({ items: [{ id: 1, analysis_status: 'pending' }] }))

    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    const stableCallback = vi.fn()

    const { result, rerender } = renderHook(
      ({ cb }) => usePendingPolling({ onPendingChanged: cb }),
      { initialProps: { cb: stableCallback } }
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.pollingActive).toBe(true)
    const intervalCountAfterStart = setIntervalSpy.mock.calls.length

    rerender({ cb: stableCallback })

    expect(setIntervalSpy.mock.calls.length).toBe(intervalCountAfterStart)
  })
})

describe('useUpload', () => {
  it('prefers nested API error messages when an upload fails', async () => {
    axios.post.mockRejectedValue({
      response: {
        data: {
          error: {
            message: 'Nested upload error.'
          }
        }
      }
    })

    const onCreated = vi.fn()
    const { result } = renderHook(() => useUpload({ onCreated }))

    await act(async () => {
      await result.current.uploadFiles([new File(['a'], 'boom.png', { type: 'image/png' })])
    })

    expect(result.current.uploadMessage).toBe('Nested upload error.')
    expect(result.current.uploadErrors).toEqual(['Nested upload error.'])
    expect(result.current.uploadProgress).toBe(0)
    expect(onCreated).not.toHaveBeenCalled()
  })
})

describe('useDetailModal', () => {
  beforeEach(() => {
    // The usePendingPolling describe leaves a vi.spyOn(window, 'setInterval') spy not fully restored by vi.clearAllMocks(); restore it here so waitFor works.
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('openDetail sets detailId and triggers a detail fetch from the API', async () => {
    global.fetch.mockResolvedValueOnce(makeResponse({ id: 1, filename: 'cat.png', description: 'a cat' }))

    const { result } = renderHook(() =>
      useDetailModal({ removePendingById: vi.fn(), refreshCollection: vi.fn() })
    )

    await act(async () => {
      result.current.openDetail({ id: 1, description: 'preview' })
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.detail?.description).toBe('a cat')
    expect(result.current.detailId).toBe(1)
    expect(result.current.detailLoading).toBe(false)
  })

  it('loadDetail sets a fallback error when the API responds with !ok and no detail field', async () => {
    global.fetch.mockResolvedValueOnce(makeResponse({}, false))

    const { result } = renderHook(() =>
      useDetailModal({ removePendingById: vi.fn(), refreshCollection: vi.fn() })
    )

    await act(async () => {
      result.current.openDetail({ id: 11, description: 'preview' })
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.detailError).toBe('Could not load meme details.')
  })

  it('loadDetail sets a fallback error when fetch throws without a message property', async () => {
    global.fetch.mockRejectedValueOnce({})

    const { result } = renderHook(() =>
      useDetailModal({ removePendingById: vi.fn(), refreshCollection: vi.fn() })
    )

    await act(async () => {
      result.current.openDetail({ id: 12, description: 'preview' })
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.detailError).toBe('Could not load meme details.')
  })

  it('closeDetail resets all state to initial values', async () => {
    global.fetch.mockResolvedValueOnce(makeResponse({ id: 2, filename: 'dog.png', description: 'a dog' }))

    const { result } = renderHook(() =>
      useDetailModal({ removePendingById: vi.fn(), refreshCollection: vi.fn() })
    )

    act(() => {
      result.current.openDetail({ id: 2, description: 'preview' })
    })
    await waitFor(() => {
      expect(result.current.detailId).toBe(2)
    })

    act(() => {
      result.current.closeDetail()
    })

    expect(result.current.detailId).toBeNull()
    expect(result.current.detail).toBeNull()
    expect(result.current.detailSaving).toBe(false)
    expect(result.current.detailError).toBe('')
  })

  it('saveMemeDetails puts to the API and invokes onMemeChanged callbacks on success', async () => {
    global.fetch
      .mockResolvedValueOnce(makeResponse({ id: 3, description: 'loaded' }))
      .mockResolvedValueOnce(makeResponse({ id: 3, description: 'saved' }))

    const removePendingById = vi.fn()
    const refreshCollection = vi.fn()
    const { result } = renderHook(() =>
      useDetailModal({ removePendingById, refreshCollection })
    )

    await act(async () => {
      result.current.openDetail({ id: 3, description: 'preview' })
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    await act(async () => {
      await result.current.saveMemeDetails({ description: 'saved' })
    })

    expect(result.current.detail?.description).toBe('saved')
    expect(removePendingById).toHaveBeenCalledWith(3)
    expect(refreshCollection).toHaveBeenCalled()
    expect(result.current.detailSaving).toBe(false)
  })

  it('saveMemeDetails sets detailError and rethrows when the API responds with !ok', async () => {
    global.fetch
      .mockResolvedValueOnce(makeResponse({ id: 4, description: 'loaded' }))
      .mockResolvedValueOnce(makeResponse({ detail: 'Save failed.' }, false))

    const { result } = renderHook(() =>
      useDetailModal({ removePendingById: vi.fn(), refreshCollection: vi.fn() })
    )

    await act(async () => {
      result.current.openDetail({ id: 4, description: 'preview' })
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    let caughtError
    await act(async () => {
      try {
        await result.current.saveMemeDetails({ description: 'updated' })
      } catch (err) {
        caughtError = err
      }
    })

    expect(caughtError).toBeDefined()
    expect(result.current.detailError).toBe('Save failed.')
  })

  it('saveMemeDetails returns null without fetching when detailId is null', async () => {
    const { result } = renderHook(() =>
      useDetailModal({ removePendingById: vi.fn(), refreshCollection: vi.fn() })
    )

    const value = await result.current.saveMemeDetails({ description: 'noop' })

    expect(value).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('deleteMeme calls DELETE and invokes onMemeChanged callbacks on success', async () => {
    global.fetch
      .mockResolvedValueOnce(makeResponse({ id: 5, description: 'loaded' }))
      .mockResolvedValueOnce(makeResponse({}))

    const removePendingById = vi.fn()
    const refreshCollection = vi.fn()
    const { result } = renderHook(() =>
      useDetailModal({ removePendingById, refreshCollection })
    )

    act(() => {
      result.current.openDetail({ id: 5, description: 'preview' })
    })
    await waitFor(() => {
      expect(result.current.detailId).toBe(5)
    })

    await act(async () => {
      await result.current.deleteMeme(5)
    })

    expect(removePendingById).toHaveBeenCalledWith(5)
    expect(refreshCollection).toHaveBeenCalled()
    expect(result.current.detailId).toBeNull()
  })

  it('deleteMeme sets detailError when the API responds with !ok', async () => {
    global.fetch
      .mockResolvedValueOnce(makeResponse({ id: 6, description: 'loaded' }))
      .mockResolvedValueOnce(makeResponse({ detail: 'Delete blocked.' }, false))

    const { result } = renderHook(() =>
      useDetailModal({ removePendingById: vi.fn(), refreshCollection: vi.fn() })
    )

    act(() => {
      result.current.openDetail({ id: 6, description: 'preview' })
    })
    await waitFor(() => {
      expect(result.current.detailId).toBe(6)
    })

    await act(async () => {
      await result.current.deleteMeme(6)
    })

    expect(result.current.detailError).toBe('Delete blocked.')
  })

  it('loadDetail ignores stale responses when detailId changes before the fetch resolves', async () => {
    const firstFetch = deferred()
    global.fetch
      .mockImplementationOnce(() => firstFetch.promise)
      .mockResolvedValueOnce(makeResponse({ id: 8, description: 'second loaded' }))

    const { result } = renderHook(() =>
      useDetailModal({ removePendingById: vi.fn(), refreshCollection: vi.fn() })
    )

    await act(async () => {
      result.current.openDetail({ id: 7, description: 'first preview' })
    })
    await act(async () => {
      result.current.openDetail({ id: 8, description: 'second preview' })
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.detail?.description).toBe('second loaded')
    expect(result.current.detailId).toBe(8)

    firstFetch.resolve(makeResponse({ id: 7, description: 'stale first' }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.detail?.description).toBe('second loaded')
  })
})

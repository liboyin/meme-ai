import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import axios from 'axios'
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const POLL_INTERVAL_MS = 3000

/**
 * Poll pending meme analysis status and notify when the snapshot changes.
 *
 * @param {object} props - Hook configuration.
 * @param {Function} props.onPendingChanged - Called when pending status changes.
 * @returns {object} Pending state and helper actions.
 */
export default function usePendingPolling({ onPendingChanged }) {
  const [pendingItems, setPendingItems] = useState([])
  const [pollingActive, setPollingActive] = useState(false)
  const pendingItemsRef = useRef([])
  const pendingSnapshotRef = useRef('')
  const bootstrappedRef = useRef(false)

  /**
   * Store pending items in state and in a ref for interval callbacks.
   *
   * @param {Array<object>} items - Latest pending-status payload.
   */
  const updatePendingItems = useCallback((items) => {
    pendingItemsRef.current = items
    setPendingItems(items)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function primePendingStatus() {
      try {
        const response = await fetch('/api/memes/pending')
        const data = await response.json()
        if (!response.ok || cancelled) {
          return
        }
        if (bootstrappedRef.current) {
          return
        }
        const items = data.items || []
        pendingSnapshotRef.current = JSON.stringify(items)
        updatePendingItems(items)
        if (items.some((item) => item.analysis_status === 'pending')) {
          setPollingActive(true)
        }
      } catch {
        if (!cancelled) {
          setPendingItems([])
        }
      }
    }

    primePendingStatus()

    return () => {
      cancelled = true
    }
  }, [updatePendingItems])

  useEffect(() => {
    if (!pollingActive) {
      return undefined
    }

    let cancelled = false

    async function pollPendingStatus() {
      try {
        const response = await fetch('/api/memes/pending')
        const data = await response.json()
        if (!response.ok || cancelled) {
          throw new Error('Polling failed.')
        }

        const items = data.items || []
        const snapshot = JSON.stringify(items)
        updatePendingItems(items)

        if (snapshot !== pendingSnapshotRef.current) {
          pendingSnapshotRef.current = snapshot
          onPendingChanged()
        }

        if (!items.some((item) => item.analysis_status === 'pending')) {
          setPollingActive(false)
        }
      } catch {
        if (!cancelled && !pendingItemsRef.current.some((item) => item.analysis_status === 'pending')) {
          setPollingActive(false)
        }
      }
    }

    const intervalId = window.setInterval(pollPendingStatus, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [onPendingChanged, pollingActive, updatePendingItems])

  const pendingCount = useMemo(
    () => pendingItems.filter((item) => item.analysis_status === 'pending').length,
    [pendingItems]
  )

  function bootstrapPending(items) {
    bootstrappedRef.current = true
    updatePendingItems(items)
    setPollingActive(true)
    pendingSnapshotRef.current = JSON.stringify(items)
  }

  /**
   * Remove a meme from the tracked pending set.
   *
   * @param {number} id - Meme ID to remove.
   */
  function removePendingById(id) {
    const nextItems = pendingItemsRef.current.filter((item) => item.id !== id)
    updatePendingItems(nextItems)
  }

  return {
    pendingItems,
    pendingCount,
    pollingActive,
    setPollingActive,
    bootstrapPending,
    removePendingById
  }
}

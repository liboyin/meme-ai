import { useEffect, useMemo, useRef, useState } from 'react'

const POLL_INTERVAL_MS = 3000

export default function usePendingPolling({ onPendingChanged }) {
  const [pendingItems, setPendingItems] = useState([])
  const [pollingActive, setPollingActive] = useState(false)
  const pendingSnapshotRef = useRef('')
  const bootstrappedRef = useRef(false)

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
        setPendingItems(items)
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
  }, [])

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
        setPendingItems(items)

        if (snapshot !== pendingSnapshotRef.current) {
          pendingSnapshotRef.current = snapshot
          onPendingChanged()
        }

        if (!items.some((item) => item.analysis_status === 'pending')) {
          setPollingActive(false)
        }
      } catch {
        if (!cancelled) {
          setPollingActive(false)
        }
      }
    }

    const intervalId = window.setInterval(pollPendingStatus, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [onPendingChanged, pollingActive])

  const pendingCount = useMemo(
    () => pendingItems.filter((item) => item.analysis_status === 'pending').length,
    [pendingItems]
  )

  function bootstrapPending(items) {
    bootstrappedRef.current = true
    setPendingItems(items)
    setPollingActive(true)
    pendingSnapshotRef.current = JSON.stringify(items)
  }

  function removePendingById(id) {
    setPendingItems((current) => current.filter((item) => item.id !== id))
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

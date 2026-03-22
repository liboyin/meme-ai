import { useEffect, useMemo, useState } from 'react'

const PAGE_SIZE = 40
export const DEFAULT_SORT_OPTION = 'uploaded_at_desc'
export const GALLERY_SORT_OPTIONS = [
  { value: 'uploaded_at_desc', label: 'Newest uploads', sortBy: 'uploaded_at', sortOrder: 'desc' },
  { value: 'uploaded_at_asc', label: 'Oldest uploads', sortBy: 'uploaded_at', sortOrder: 'asc' },
  { value: 'filename_asc', label: 'Filename', sortBy: 'filename', sortOrder: 'asc' },
  { value: 'phash_asc', label: 'pHash', sortBy: 'phash', sortOrder: 'asc' }
]
const SORT_OPTIONS_BY_VALUE = Object.fromEntries(
  GALLERY_SORT_OPTIONS.map((option) => [option.value, option])
)

export default function useMemesCollection() {
  const [memes, setMemes] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [collectionError, setCollectionError] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)
  const [sortOption, setSortOption] = useState(DEFAULT_SORT_OPTION)
  const currentSort = SORT_OPTIONS_BY_VALUE[sortOption] || SORT_OPTIONS_BY_VALUE[DEFAULT_SORT_OPTION]

  useEffect(() => {
    let cancelled = false

    async function loadMemes() {
      try {
        setCollectionError('')
        const params = new URLSearchParams({
          page: String(page),
          page_size: String(PAGE_SIZE),
          sort_by: currentSort.sortBy,
          sort_order: currentSort.sortOrder
        })
        const response = await fetch(`/api/memes?${params.toString()}`)
        if (!response.ok) {
          throw new Error('Could not load memes.')
        }
        const data = await response.json()
        if (cancelled) {
          return
        }
        setMemes(data.items || [])
        setTotal(data.total || 0)
      } catch (error) {
        if (!cancelled) {
          setCollectionError(error.message || 'Could not load memes.')
        }
      }
    }

    loadMemes()

    return () => {
      cancelled = true
    }
  }, [currentSort.sortBy, currentSort.sortOrder, page, refreshToken])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])

  function refreshCollection() {
    setRefreshToken((value) => value + 1)
  }

  function changeSortOption(nextSortOption) {
    setSortOption(SORT_OPTIONS_BY_VALUE[nextSortOption] ? nextSortOption : DEFAULT_SORT_OPTION)
    setPage(1)
  }

  return {
    memes,
    page,
    setPage,
    total,
    totalPages,
    collectionError,
    refreshToken,
    refreshCollection,
    pageSize: PAGE_SIZE,
    sortOption,
    sortLabel: currentSort.label,
    sortOptions: GALLERY_SORT_OPTIONS,
    setSortOption: changeSortOption
  }
}

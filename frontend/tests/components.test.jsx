import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import Sidebar from '../src/components/Sidebar'
import MemeGrid from '../src/components/MemeGrid'
import MemeDetailModal from '../src/components/MemeDetailModal'

afterEach(() => {
  cleanup()
})

describe('Sidebar', () => {
  it('renders search/upload/stats and forwards interactions', () => {
    const onSearchQueryChange = vi.fn()
    const onRunAiSearch = vi.fn()
    const onDrop = vi.fn((event) => event.preventDefault())
    const onChooseFiles = vi.fn()

    render(
      createElement(Sidebar, {
        searchQuery: 'chaos',
        onSearchQueryChange,
        hasSearchQuery: true,
        llmLoading: false,
        onRunAiSearch,
        searchLoading: true,
        searchError: 'Search broke',
        isDragging: true,
        onDragEnter: vi.fn(),
        onDragLeave: vi.fn(),
        onDragOver: vi.fn(),
        onDrop,
        onChooseFiles,
        uploadProgress: 55,
        uploadMessage: 'uploading',
        uploadErrors: ['bad.png: nope'],
        total: 5,
        pendingCount: 2,
        searchMode: 'llm'
      })
    )

    fireEvent.change(screen.getByPlaceholderText('Describe the vibe, joke, or situation'), {
      target: { value: 'new query' }
    })
    expect(onSearchQueryChange).toHaveBeenCalledWith('new query')

    fireEvent.click(screen.getByText('Not finding it? Try AI search'))
    expect(onRunAiSearch).toHaveBeenCalledTimes(1)

    const input = screen.getByLabelText('Choose files')
    const files = [new File(['a'], 'ok.png', { type: 'image/png' })]
    fireEvent.change(input, { target: { files } })
    expect(onChooseFiles).toHaveBeenCalledWith(files)

    const dropzone = screen.getByText('Upload static memes').closest('section')
    fireEvent.drop(dropzone, { dataTransfer: { files: [] } })
    expect(onDrop).toHaveBeenCalled()

    expect(screen.getByText('Search broke')).toBeTruthy()
    expect(screen.getByText('bad.png: nope')).toBeTruthy()
    expect(screen.getByText('AI results')).toBeTruthy()
    expect(screen.getByLabelText('Upload progress').firstElementChild.style.width).toBe('55%')
  })
})

describe('MemeGrid', () => {
  it('renders cards, pending banner and pager callbacks', () => {
    const onPreviousPage = vi.fn()
    const onNextPage = vi.fn()
    const onOpenDetail = vi.fn()
    const onSortChange = vi.fn()
    const meme = { id: 7, filename: 'x.png', description: 'desc', analysis_status: 'done', tags: ['a'] }

    render(
      createElement(MemeGrid, {
        hasSearchQuery: false,
        searchResults: [],
        searchQuery: '',
        memes: [meme],
        pendingCount: 1,
        collectionError: '',
        shownMemes: [meme],
        searchLoading: false,
        page: 2,
        totalPages: 3,
        sortOption: 'uploaded_at_desc',
        sortLabel: 'Newest uploads',
        sortOptions: [
          { value: 'uploaded_at_desc', label: 'Newest uploads' },
          { value: 'filename_asc', label: 'Filename' }
        ],
        onSortChange,
        onPreviousPage,
        onNextPage,
        onOpenDetail
      })
    )

    fireEvent.click(screen.getByText('x.png'))
    expect(onOpenDetail).toHaveBeenCalledWith(meme)

    fireEvent.click(screen.getByText('Previous'))
    fireEvent.click(screen.getByText('Next'))
    expect(onPreviousPage).toHaveBeenCalledTimes(1)
    expect(onNextPage).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByLabelText('Sort gallery'), {
      target: { value: 'filename_asc' }
    })
    expect(onSortChange).toHaveBeenCalledWith('filename_asc')

    expect(screen.getByText(/still being analysed/)).toBeTruthy()
  })

  it('renders search empty state', () => {
    render(
      createElement(MemeGrid, {
        hasSearchQuery: true,
        searchResults: [],
        searchQuery: 'weird',
        memes: [],
        pendingCount: 0,
        collectionError: 'Could not load memes.',
        shownMemes: [],
        searchLoading: false,
        page: 1,
        totalPages: 1,
        sortOption: 'uploaded_at_desc',
        sortLabel: 'Newest uploads',
        sortOptions: [{ value: 'uploaded_at_desc', label: 'Newest uploads' }],
        onSortChange: vi.fn(),
        onPreviousPage: vi.fn(),
        onNextPage: vi.fn(),
        onOpenDetail: vi.fn()
      })
    )

    expect(screen.getByText('No matches yet')).toBeTruthy()
    expect(screen.getByText('Could not load memes.')).toBeTruthy()
  })
})

describe('MemeDetailModal', () => {
  it('does not render when no detail id exists', () => {
    render(
      createElement(MemeDetailModal, {
        detailId: null,
        detail: null,
        detailLoading: false,
        detailError: '',
        onClose: vi.fn(),
        onDelete: vi.fn()
      })
    )

    expect(screen.queryByText('Meme detail')).toBeNull()
  })

  it('renders details and calls close/delete handlers', () => {
    const onClose = vi.fn()
    const onDelete = vi.fn()

    render(
      createElement(MemeDetailModal, {
        detailId: 9,
        detail: {
          filename: 'focus.png',
          analysis_status: 'error',
          analysis_error: 'broken analysis',
          mime_type: 'image/png',
          description: '',
          why_funny: '',
          references: '',
          use_cases: '',
          tags: []
        },
        detailLoading: true,
        detailError: 'detail failed',
        onClose,
        onDelete
      })
    )

    fireEvent.click(screen.getByText('Delete meme'))
    expect(onDelete).toHaveBeenCalledWith(9)

    fireEvent.click(screen.getByText('Close'))
    expect(onClose).toHaveBeenCalled()

    expect(screen.getByText('broken analysis')).toBeTruthy()
    expect(screen.getByText('No tags yet.')).toBeTruthy()
  })

  it('edits metadata, saves trimmed values, and closes on backdrop click', async () => {
    const onClose = vi.fn()
    const onDelete = vi.fn()
    const onSave = vi.fn().mockResolvedValue({})

    render(
      createElement(MemeDetailModal, {
        detailId: 5,
        detail: {
          filename: 'edit.png',
          analysis_status: 'done',
          analysis_error: null,
          mime_type: 'image/png',
          description: 'old desc',
          why_funny: 'old joke',
          references: 'old ref',
          use_cases: 'old use',
          tags: ['old']
        },
        detailLoading: false,
        detailSaving: false,
        detailError: '',
        onClose,
        onSave,
        onDelete
      })
    )

    fireEvent.click(screen.getByText('Edit fields'))
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: '  new desc  ' }
    })
    fireEvent.change(screen.getByLabelText('Why it is funny'), {
      target: { value: '  still funny  ' }
    })
    fireEvent.change(screen.getByLabelText('References'), {
      target: { value: '  forum lore  ' }
    })
    fireEvent.change(screen.getByLabelText('Use cases'), {
      target: { value: '  replies  ' }
    })
    fireEvent.change(screen.getByLabelText('Comma-separated tags'), {
      target: { value: ' wow, neat ' }
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Save metadata'))
    })

    expect(onSave).toHaveBeenCalledWith({
      description: 'new desc',
      why_funny: 'still funny',
      references: 'forum lore',
      use_cases: 'replies',
      tags: ['wow', 'neat']
    })
    expect(screen.queryByText('Save metadata')).toBeNull()

    fireEvent.click(document.querySelector('.modal'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps edits visible after a failed save and lets the user cancel them', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Save failed.'))

    render(
      createElement(MemeDetailModal, {
        detailId: 6,
        detail: {
          filename: 'retry.png',
          analysis_status: 'done',
          analysis_error: null,
          mime_type: 'image/png',
          description: 'seed text',
          why_funny: '',
          references: '',
          use_cases: '',
          tags: []
        },
        detailLoading: false,
        detailSaving: false,
        detailError: 'Parent error',
        onClose: vi.fn(),
        onSave,
        onDelete: vi.fn()
      })
    )

    fireEvent.click(screen.getByText('Edit fields'))
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'draft text' }
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Save metadata'))
    })

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(screen.getByDisplayValue('draft text')).toBeTruthy()
    expect(screen.getByText('Parent error')).toBeTruthy()

    fireEvent.click(screen.getByText('Cancel changes'))
    expect(screen.queryByText('Save metadata')).toBeNull()
    expect(screen.getByText('seed text')).toBeTruthy()
  })
})

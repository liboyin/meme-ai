import { createElement } from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from '../src/App'

beforeEach(() => {
  global.fetch = vi.fn(async (url) => {
    if (String(url).startsWith('/api/memes?')) {
      return { ok: true, json: async () => ({ items: [], total: 0 }) }
    }
    if (String(url).startsWith('/api/memes/pending')) {
      return { ok: true, json: async () => ({ items: [] }) }
    }
    if (String(url).startsWith('/api/search')) {
      return { ok: true, json: async () => ({ items: [] }) }
    }
    return { ok: true, json: async () => ({}) }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('App', () => {
  it('renders title', async () => {
    render(createElement(App))
    expect(await screen.findByText('Meme Organiser')).toBeTruthy()
  })

  it('renders upload guidance', async () => {
    render(createElement(App))
    expect(await screen.findByText('Upload static memes')).toBeTruthy()
    expect(await screen.findByText('Your meme vault is empty')).toBeTruthy()
  })
})

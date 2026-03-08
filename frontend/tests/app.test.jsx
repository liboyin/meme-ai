import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../src/App'

beforeEach(() => {
  global.fetch = vi.fn(async (url) => {
    if (String(url).startsWith('/api/memes?')) return { json: async () => ({ items: [], total: 0 }) }
    if (String(url).startsWith('/api/memes/pending')) return { json: async () => ({ items: [] }) }
    if (String(url).startsWith('/api/search')) return { json: async () => ({ items: [] }) }
    return { json: async () => ({}) }
  })
})

describe('App', () => {
  it('renders title', async () => {
    render(<App />)
    expect(await screen.findByText('Meme Organiser')).toBeTruthy()
  })
})

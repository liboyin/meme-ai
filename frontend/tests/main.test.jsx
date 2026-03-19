import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('main entrypoint', () => {
  it('mounts the app into the root element', async () => {
    document.body.innerHTML = '<div id="root"></div>'

    const render = vi.fn()
    const createRoot = vi.fn(() => ({ render }))

    vi.doMock('react-dom/client', () => ({
      createRoot
    }))
    vi.doMock('../src/App', () => ({
      default: () => null
    }))

    await import('../src/main.jsx')

    expect(createRoot).toHaveBeenCalledWith(document.getElementById('root'))
    expect(render).toHaveBeenCalledTimes(1)
  })
})

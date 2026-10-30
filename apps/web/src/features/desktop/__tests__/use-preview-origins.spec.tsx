import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { PREVIEW_ORIGINS_PATH } from '../preview-origins'
import { usePreviewOrigins } from '../use-preview-origins'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const realFetch = globalThis.fetch
let posted: { path: string; body: unknown }[]
let release: () => void

beforeEach(() => {
  posted = []
  release = () => undefined
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      posted.push({ path: String(input), body: JSON.parse(String(init?.body)) })
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return new Response(null, { status: 204 })
    },
    { preconnect: realFetch.preconnect },
  )
})
afterEach(() => {
  globalThis.fetch = realFetch
  Reflect.deleteProperty(window, 'atlasDesktop')
  document.body.innerHTML = ''
})

function Probe({ urls }: { urls: string[] }) {
  return <p>{usePreviewOrigins(urls) ? 'ready' : 'waiting'}</p>
}

const mount = async (urls: string[]) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<Probe urls={urls} />))
  return { container, root }
}

describe('usePreviewOrigins', () => {
  it('is ready at once and posts nothing outside the desktop app', async () => {
    const { container } = await mount(['https://sb.vercel.run/'])
    expect(container.textContent).toBe('ready')
    expect(posted).toEqual([])
  })

  it('on desktop, holds the frame until the host allows its origins, then clears on unmount', async () => {
    Reflect.set(window, 'atlasDesktop', { vibrancy: false })
    const { container, root } = await mount(['https://sb.vercel.run/app'])
    expect(container.textContent).toBe('waiting')
    expect(posted).toEqual([
      { path: PREVIEW_ORIGINS_PATH, body: { origins: ['https://sb.vercel.run'] } },
    ])
    await act(async () => release())
    expect(container.textContent).toBe('ready')
    await act(async () => root.unmount())
    expect(posted.at(-1)).toEqual({ path: PREVIEW_ORIGINS_PATH, body: { origins: [] } })
  })
})

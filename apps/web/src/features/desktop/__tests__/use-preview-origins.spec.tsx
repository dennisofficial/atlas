import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { PREVIEW_ORIGINS_PATH } from '../preview-origins'
import { EPreviewGate, PREVIEW_RETRY_DELAY_MS, usePreviewOrigins } from '../use-preview-origins'

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
let outcomes: (number | 'throw' | 'hang')[]
let mounted: { unmount: () => void }[]

beforeEach(() => {
  posted = []
  release = () => undefined
  outcomes = ['hang']
  mounted = []
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      posted.push({ path: String(input), body: JSON.parse(String(init?.body)) })
      const outcome = outcomes.shift() ?? 204
      if (outcome === 'throw') throw new TypeError('network down')
      if (outcome === 'hang') {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: outcome })
    },
    { preconnect: realFetch.preconnect },
  )
})
afterEach(async () => {
  await act(async () => {
    for (const root of mounted) root.unmount()
  })
  globalThis.fetch = realFetch
  Reflect.deleteProperty(window, 'atlasDesktop')
  document.body.innerHTML = ''
})

function Probe({ urls }: { urls: string[] }) {
  return <p>{usePreviewOrigins(urls)}</p>
}

const mount = async (urls: string[]) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push(root)
  await act(async () => root.render(<Probe urls={urls} />))
  return { container, root }
}

describe('usePreviewOrigins', () => {
  it('is ready at once and posts nothing outside the desktop app', async () => {
    const { container } = await mount(['https://sb.vercel.run/'])
    expect(container.textContent).toBe(EPreviewGate.Ready)
    expect(posted).toEqual([])
  })

  it('on desktop, holds the frame until the host allows its origins, then clears on unmount', async () => {
    Reflect.set(window, 'atlasDesktop', { vibrancy: false })
    const { container, root } = await mount(['https://sb.vercel.run/app'])
    expect(container.textContent).toBe(EPreviewGate.Waiting)
    expect(posted).toEqual([
      {
        path: PREVIEW_ORIGINS_PATH,
        body: { origins: ['https://sb.vercel.run'] },
      },
    ])
    await act(async () => release())
    expect(container.textContent).toBe(EPreviewGate.Ready)
    await act(async () => root.unmount())
    expect(posted.at(-1)).toEqual({
      path: PREVIEW_ORIGINS_PATH,
      body: { origins: [] },
    })
  })

  describe('on desktop when the host rejects or is unreachable', () => {
    const origins = {
      path: PREVIEW_ORIGINS_PATH,
      body: { origins: ['https://sb.vercel.run'] },
    }

    const mountDesktop = async () => {
      Reflect.set(window, 'atlasDesktop', { vibrancy: false })
      return mount(['https://sb.vercel.run/app'])
    }
    const waitForRetry = () => act(async () => void (await Bun.sleep(PREVIEW_RETRY_DELAY_MS + 100)))

    it('is ready when the first post succeeds, without retrying', async () => {
      outcomes = [204]
      const { container } = await mountDesktop()
      expect(container.textContent).toBe(EPreviewGate.Ready)
      expect(posted).toEqual([origins])
    })

    it('keeps waiting through the retry delay after a non-ok response', async () => {
      outcomes = [400]
      const { container } = await mountDesktop()
      expect(container.textContent).toBe(EPreviewGate.Waiting)
      expect(posted).toEqual([origins])
    })

    it('is ready when the retry succeeds', async () => {
      outcomes = [400, 204]
      const { container } = await mountDesktop()
      await waitForRetry()
      expect(container.textContent).toBe(EPreviewGate.Ready)
      expect(posted).toEqual([origins, origins])
    })

    it('fails when the retry is also non-ok', async () => {
      outcomes = [405, 400]
      const { container } = await mountDesktop()
      await waitForRetry()
      expect(container.textContent).toBe(EPreviewGate.Failed)
      expect(posted).toEqual([origins, origins])
    })

    it('fails when fetch throws on both attempts', async () => {
      outcomes = ['throw', 'throw']
      const { container } = await mountDesktop()
      await waitForRetry()
      expect(container.textContent).toBe(EPreviewGate.Failed)
      expect(posted).toEqual([origins, origins])
    })

    it('does not retry after unmount', async () => {
      outcomes = [400]
      const { root } = await mountDesktop()
      await act(async () => root.unmount())
      await waitForRetry()
      expect(posted).toEqual([origins, { path: PREVIEW_ORIGINS_PATH, body: { origins: [] } }])
    })
  })
})

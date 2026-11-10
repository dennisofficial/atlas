import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { act, type ReactNode } from 'react'

import type { PaneCommand } from '../desktop/pane-command'
import { resetPaneAvailability } from '../desktop/pane-client'
import { ETabPage } from '../tab-page'

const PAGE = { kind: ETabPage.Frame, port: undefined } as const

const originalError = console.error
const originalFetch = globalThis.fetch
const sent: PaneCommand[] = []

const answerWith = (status: number) => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as PaneCommand)
    return new Response(JSON.stringify({ ok: false, error: String(input) }), { status })
  }) as typeof fetch
}

const settle = () => act(async () => new Promise<void>((done) => setTimeout(done, 20)))

async function mountBody() {
  const { createRoot } = await import('react-dom/client')
  const { PreviewTabBody } = await import('../preview-tab-body')
  const { useFrameRegistry } = await import('../frame-registry')

  const seen: Array<HTMLElement | undefined> = []
  function Probe() {
    seen.push(useFrameRegistry().visible?.element)
    return null
  }

  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const view: ReactNode = (
    <>
      <PreviewTabBody
        threadId="t1"
        tabId="tab-1"
        url="https://example.com/"
        page={PAGE}
        ports={[]}
        onNavigate={() => undefined}
      />
      <Probe />
    </>
  )
  await act(async () => root.render(view))
  await settle()
  return { host, seen }
}

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  console.error = () => undefined
})

afterAll(async () => {
  console.error = originalError
  globalThis.fetch = originalFetch
  await GlobalRegistrator.unregister()
})

beforeEach(() => {
  sent.length = 0
  resetPaneAvailability()
})

afterEach(() => {
  resetPaneAvailability()
  globalThis.fetch = originalFetch
})

describe('a host with no pane route', () => {
  it('keeps rendering the preview in the page', async () => {
    answerWith(404)
    const { seen } = await mountBody()
    expect(seen.at(-1)).toBeInstanceOf(HTMLElement)
  })

  it('only probes, and never tries to drive a pane', async () => {
    answerWith(404)
    await mountBody()
    expect(sent).toEqual([{ kind: 'hide' }])
  })

  it('falls back when the route rejects the probe', async () => {
    answerWith(400)
    const { seen } = await mountBody()
    expect(seen.at(-1)).toBeInstanceOf(HTMLElement)
  })

  it('falls back when the endpoint cannot be reached', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const { seen } = await mountBody()
    expect(seen.at(-1)).toBeInstanceOf(HTMLElement)
  })
})

describe('a host with the pane route', () => {
  it('hands the pane to the shell instead of the in-page slot', async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)) as PaneCommand)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch
    const { seen } = await mountBody()
    expect(seen.at(-1)).toBeUndefined()
    expect(sent.map((command) => command.kind)).toEqual(['hide'])
  })
})

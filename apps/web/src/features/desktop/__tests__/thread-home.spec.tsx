import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { DesktopError, resetDesktopCapabilities } from '../desktop-wire'
import { useDesktop } from '../use-desktop'
import { EThreadHome, useThreadHome } from '../use-local-pod'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => GlobalRegistrator.unregister())

const realFetch = globalThis.fetch
const roots: ReturnType<typeof createRoot>[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  globalThis.fetch = realFetch
  resetDesktopCapabilities()
  Reflect.deleteProperty(window, 'atlasDesktop')
  document.body.innerHTML = ''
})

describe('thread home lookup', () => {
  it('keeps an unavailable local host out of the Cloud backend', async () => {
    Reflect.set(window, 'atlasDesktop', {})
    globalThis.fetch = Object.assign(
      async () =>
        Response.json({ message: 'host unavailable', code: 'unavailable' }, { status: 503 }),
      { preconnect: realFetch.preconnect },
    )
    let latest: ReturnType<typeof useThreadHome> | undefined
    function Probe() {
      latest = useThreadHome({
        threadId: 'brn_local',
        desktop: { ready: true, present: true, docker: true, reason: undefined },
      })
      return null
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => root.render(<Probe />))
    expect(latest).toMatchObject({ home: EThreadHome.Loading })
    expect(latest?.error).toBeInstanceOf(DesktopError)
    expect(latest?.error).toMatchObject({ status: 503, code: 'unavailable' })
  })

  it('does not lose native identity when capabilities are unavailable', async () => {
    Reflect.set(window, 'atlasDesktop', {})
    globalThis.fetch = Object.assign(
      async () => Response.json({ message: 'host unavailable' }, { status: 503 }),
      { preconnect: realFetch.preconnect },
    )
    let latest: ReturnType<typeof useThreadHome> | undefined
    function Probe() {
      latest = useThreadHome({ threadId: 'brn_local', desktop: useDesktop() })
      return null
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => root.render(<Probe />))
    expect(latest?.home).toBe(EThreadHome.Loading)
    expect(latest?.error).toMatchObject({ status: 503 })
  })

  it('classifies projectless roots from host summaries without consulting pod placement', async () => {
    Reflect.set(window, 'atlasDesktop', {})
    const calls: string[] = []
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        calls.push(String(input))
        return Response.json({
          threads: [
            {
              threadId: 'brn_projectless',
              projectId: null,
              head: 8,
              readSeq: 3,
              createdAt: '2026-10-31T10:00:00.000Z',
              updatedAt: '2026-10-31T11:00:00.000Z',
              status: {
                working: false,
                awaiting: null,
                lastOutcome: 'completed',
                podState: 'parked',
                lastAssistantSeq: 8,
                readSeq: 3,
              },
            },
          ],
        })
      },
      { preconnect: realFetch.preconnect },
    )
    let latest: ReturnType<typeof useThreadHome> | undefined
    function Probe() {
      latest = useThreadHome({
        threadId: 'brn_projectless',
        desktop: { ready: true, present: true, docker: true, reason: undefined },
      })
      return null
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => root.render(<Probe />))
    expect(latest).toEqual({ home: EThreadHome.ThisMac, error: null })
    expect(calls).toEqual(['/desktop/threads'])
  })

  it('does not probe desktop routes in the hosted browser', async () => {
    const calls: unknown[] = []
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        calls.push(input)
        return new Response(null, { status: 404 })
      },
      { preconnect: realFetch.preconnect },
    )
    let latest: ReturnType<typeof useThreadHome> | undefined
    function Probe() {
      latest = useThreadHome({
        threadId: 'brn_cloud',
        desktop: { ready: true, present: false, docker: false, reason: undefined },
      })
      return null
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => root.render(<Probe />))
    expect(latest).toEqual({ home: EThreadHome.Cloud, error: null })
    expect(calls).toEqual([])
  })
})

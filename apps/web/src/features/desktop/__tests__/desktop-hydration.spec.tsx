import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { act, useEffect, type ReactElement } from 'react'
import type { Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'

import { resetDesktopCapabilities } from '../desktop-wire'
import { localSummary } from './local-thread-fixture'
import { useDesktop, type Desktop } from '../use-desktop'
import { EThreadHome, useThreadHome } from '../use-local-pod'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const realFetch = globalThis.fetch
let roots: Root[] = []
let calls: string[] = []
let routes: Record<string, () => Promise<Response>> = {}

beforeEach(() => {
  resetDesktopCapabilities()
  calls = []
  routes = {}
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      const path = String(input)
      calls.push(path)
      return routes[path]?.() ?? new Response('not found', { status: 404 })
    },
    { preconnect: realFetch.preconnect },
  )
})
afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount()
  })
  roots = []
  globalThis.fetch = realFetch
  Reflect.deleteProperty(window, 'atlasDesktop')
  document.body.innerHTML = ''
})

type Snapshot = { desktop: Desktop; home: EThreadHome }
type Observation = { snapshots: Snapshot[]; mounts: EThreadHome[] }

function Thread({ home, observation }: { home: EThreadHome; observation: Observation }) {
  useEffect(() => {
    observation.mounts.push(home)
    if (home === EThreadHome.Cloud) void fetch('/cloud/threads/brn_1')
  }, [home, observation])
  return <p>{home}</p>
}

function Probe({ observation }: { observation: Observation }) {
  const desktop = useDesktop()
  const { home, error } = useThreadHome({ threadId: 'brn_1', desktop })
  observation.snapshots.push({ desktop, home })
  if (error) return <p>{error.message}</p>
  if (home === EThreadHome.Loading) return null
  return <Thread home={home} observation={observation} />
}

function serverMarkup(element: ReactElement): string {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'window')
  try {
    return renderToString(element)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor)
  }
}

async function hydrate(observation: Observation) {
  const element = <Probe observation={observation} />
  const markup = serverMarkup(element)
  const container = document.createElement('div')
  container.innerHTML = markup
  document.body.append(container)
  const errors: unknown[] = []
  const { hydrateRoot } = await import('react-dom/client')
  await act(async () => {
    roots.push(
      hydrateRoot(container, element, { onRecoverableError: (error) => errors.push(error) }),
    )
  })
  return { markup, container, errors }
}

function deferredResponse() {
  let resolve: (response: Response) => void = () => undefined
  const promise = new Promise<Response>((release) => {
    resolve = release
  })
  return { promise, resolve }
}

describe('desktop hydration', () => {
  it('hydrates the server loading branch before showing a browser cloud thread without host requests', async () => {
    const observation: Observation = { snapshots: [], mounts: [] }
    const { markup, container, errors } = await hydrate(observation)

    expect(markup).toBe('')
    expect(errors).toEqual([])
    expect(observation.snapshots[0]).toMatchObject({
      desktop: { ready: false, present: false },
      home: EThreadHome.Loading,
    })
    expect(observation.snapshots[1]).toEqual(observation.snapshots[0])
    expect(container.textContent).toBe(EThreadHome.Cloud)
    expect(observation.mounts).toEqual([EThreadHome.Cloud])
    expect(calls).toEqual(['/cloud/threads/brn_1'])
  })

  it('classifies a client-only browser mount synchronously without capabilities', async () => {
    const observation: Observation = { snapshots: [], mounts: [] }
    const container = document.createElement('div')
    document.body.append(container)
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(container)
    roots.push(root)
    await act(async () => root.render(<Probe observation={observation} />))

    expect(observation.snapshots[0]).toMatchObject({
      desktop: { ready: true, present: false },
      home: EThreadHome.Cloud,
    })
    expect(calls).toEqual(['/cloud/threads/brn_1'])
  })

  it('keeps unavailable native capabilities local through hydration and surfaces lookup errors', async () => {
    Reflect.set(window, 'atlasDesktop', {})
    routes['/desktop/capabilities'] = async () => new Response('unavailable', { status: 503 })
    routes['/desktop/threads'] = async () =>
      Response.json({ message: 'host unavailable' }, { status: 503 })
    const observation: Observation = { snapshots: [], mounts: [] }
    const { container, errors } = await hydrate(observation)

    expect(errors).toEqual([])
    expect(observation.snapshots.at(-1)?.desktop).toEqual({
      ready: true,
      present: true,
      docker: false,
      reason: 'This Mac host is unavailable',
    })
    expect(container.textContent).toContain('host unavailable')
    expect(observation.mounts).toEqual([])
    expect(calls).toEqual(['/desktop/capabilities', '/desktop/threads'])
  })

  it.each([{}, { vibrancy: false }, { vibrancy: true }])(
    'keeps a Mac bridge %j pending until its stored thread is known without mounting cloud',
    async (bridge) => {
      Reflect.set(window, 'atlasDesktop', bridge)
      const capabilities = deferredResponse()
      const pod = deferredResponse()
      routes['/desktop/capabilities'] = () => capabilities.promise
      routes['/desktop/threads'] = () => pod.promise
      const observation: Observation = { snapshots: [], mounts: [] }
      const { markup, container, errors } = await hydrate(observation)

      expect(markup).toBe('')
      expect(errors).toEqual([])
      expect(observation.snapshots.every(({ desktop }) => !desktop.ready)).toBe(true)
      expect(observation.snapshots.every(({ home }) => home === EThreadHome.Loading)).toBe(true)
      expect(observation.mounts).toEqual([])
      expect(calls).toEqual(['/desktop/capabilities'])

      await act(async () => capabilities.resolve(Response.json({ docker: true })))
      expect(container.textContent).toBe('')
      expect(observation.mounts).toEqual([])
      expect(calls).toEqual(['/desktop/capabilities', '/desktop/threads'])

      await act(async () => pod.resolve(Response.json({ threads: [localSummary] })))
      expect(container.textContent).toBe(EThreadHome.ThisMac)
      expect(observation.snapshots.at(-1)).toMatchObject({
        desktop: { ready: true, present: true, docker: true },
        home: EThreadHome.ThisMac,
      })
      expect(observation.mounts).toEqual([EThreadHome.ThisMac])
      expect(calls).toEqual(['/desktop/capabilities', '/desktop/threads'])
      expect(errors).toEqual([])
    },
  )
})

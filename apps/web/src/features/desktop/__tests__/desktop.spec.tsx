import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { act, type ReactElement } from 'react'

import { EPodConnectOutcome } from '@/features/threads/data/pod-connect'

import { createLocalThread } from '../create-local-thread'
import { resetDesktopCapabilities } from '../desktop-wire'
import { deliverHeldFirstMessage, holdFirstMessage } from '../first-message'
import { localThreadOf, withLocalThreads } from '../local-thread'
import { mintLocalPod } from '../local-thread-source'
import { ERunnerChoice, RunnerToggle } from '../runner-toggle'
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
let calls: { path: string; method: string; body: unknown }[]
let routes: Record<string, () => Response>

const pod = (state = 'running') => ({
  threadId: 'brn_1',
  projectId: 'p1',
  createdAt: '2026-10-29T10:00:00.000Z',
  state,
})

beforeEach(() => {
  calls = []
  routes = {}
  resetDesktopCapabilities()
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const path = String(input)
      const method = init?.method ?? 'GET'
      calls.push({
        path,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      const route = routes[`${method} ${path}`]
      return route ? route() : new Response('not found', { status: 404 })
    },
    { preconnect: realFetch.preconnect },
  )
})
afterEach(() => {
  globalThis.fetch = realFetch
  document.body.innerHTML = ''
  Reflect.deleteProperty(window, 'atlasDesktop')
})

const mount = async (element: ReactElement) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(element))
  return () => act(async () => root.unmount())
}

function Probe({ onValue }: { onValue: (desktop: Desktop) => void }) {
  onValue(useDesktop())
  return null
}

const probe = async () => {
  let latest: Desktop | undefined
  await mount(<Probe onValue={(value) => (latest = value)} />)
  return () => latest
}

describe('useDesktop', () => {
  it('never probes the host outside the Mac app', async () => {
    const read = await probe()
    expect(read()).toMatchObject({ ready: true, present: false })
    expect(calls).toEqual([])
  })

  it('is absent on invalid JSON', async () => {
    routes['GET /desktop/capabilities'] = () => new Response('<html>', { status: 200 })
    const read = await probe()
    expect(read()?.present).toBe(false)
  })

  it('is present with docker flag and reason once the Mac bridge is up', async () => {
    Reflect.set(window, 'atlasDesktop', { vibrancy: false })
    try {
      routes['GET /desktop/capabilities'] = () =>
        Response.json({ docker: false, reason: 'Docker is not running' })
      const read = await probe()
      expect(read()).toMatchObject({
        present: true,
        docker: false,
        reason: 'Docker is not running',
      })
    } finally {
      Reflect.deleteProperty(window, 'atlasDesktop')
    }
  })

  it('probes the host once the Mac bridge is present', async () => {
    Reflect.set(window, 'atlasDesktop', { vibrancy: false })
    try {
      routes['GET /desktop/capabilities'] = () => Response.json({ docker: true, reason: undefined })
      const read = await probe()
      expect(read()).toMatchObject({ present: true, docker: true })
      expect(calls.map((call) => call.path)).toEqual(['/desktop/capabilities'])
    } finally {
      Reflect.deleteProperty(window, 'atlasDesktop')
    }
  })
})

describe('RunnerToggle', () => {
  const desktop = (over: Partial<Desktop>): Desktop => ({
    ready: true,
    present: true,
    docker: true,
    reason: undefined,
    ...over,
  })

  it('renders nothing without desktop', async () => {
    await mount(
      <RunnerToggle
        desktop={desktop({ present: false })}
        value={ERunnerChoice.Cloud}
        onValueChange={() => undefined}
      />,
    )
    expect(document.body.textContent).toBe('')
  })

  it('shows both options and enables This Mac when docker is up', async () => {
    await mount(
      <RunnerToggle
        desktop={desktop({})}
        value={ERunnerChoice.Cloud}
        onValueChange={() => undefined}
      />,
    )
    expect(document.body.textContent).toContain('Cloud')
    const mac = document.body.querySelector<HTMLButtonElement>('button[aria-label="This Mac"]')
    expect(mac?.disabled).toBe(false)
  })

  it('disables This Mac with the reason when docker is down', async () => {
    await mount(
      <RunnerToggle
        desktop={desktop({ docker: false, reason: 'Docker is not running' })}
        value={ERunnerChoice.Cloud}
        onValueChange={() => undefined}
      />,
    )
    const mac = document.body.querySelector<HTMLButtonElement>('button[aria-label="This Mac"]')
    expect(mac?.disabled).toBe(true)
    expect(mac?.title).toBe('Docker is not running')
  })
})

describe('createLocalThread', () => {
  it('posts the pod and holds the first message until the channel is live', async () => {
    Reflect.set(window, 'atlasDesktop', {})
    routes['POST /desktop/pods'] = () => Response.json(pod())
    const id = await createLocalThread({
      threadId: 'brn_1',
      projectId: 'p1',
      model: 'm',
      effort: 'high',
      text: 'hello',
      sendId: 's1',
    })
    expect(id).toBe('brn_1')
    expect(calls).toEqual([
      {
        path: '/desktop/pods',
        method: 'POST',
        body: {
          threadId: 'brn_1',
          projectId: 'p1',
          model: 'm',
          effort: 'high',
        },
      },
    ])
    const sent: unknown[] = []
    expect(deliverHeldFirstMessage({ threadId: 'brn_1', send: () => false })).toBe(false)
    expect(
      deliverHeldFirstMessage({
        threadId: 'brn_1',
        send: (message) => (sent.push(message), true),
      }),
    ).toBe(true)
    expect(sent).toEqual([{ text: 'hello', requestId: 's1' }])
    expect(deliverHeldFirstMessage({ threadId: 'brn_1', send: () => true })).toBe(false)
  })

  it('the held first message carries its uploads to the live channel', () => {
    const upload = {
      uploadId: '00000000-0000-4000-8000-000000000001',
      pathname: 'uploads/notes.txt',
      name: 'notes.txt',
      size: 5,
      mediaType: 'text/plain',
    }
    holdFirstMessage({ threadId: 'brn_2', text: 'see file', sendId: 's2', uploads: [upload] })
    const sent: unknown[] = []
    deliverHeldFirstMessage({
      threadId: 'brn_2',
      send: (message) => {
        sent.push(message)
        return true
      },
    })
    expect(sent).toEqual([{ text: 'see file', requestId: 's2', uploads: [upload] }])
  })
})

describe('data-source routing', () => {
  beforeEach(() => Reflect.set(window, 'atlasDesktop', {}))
  const present: Desktop = {
    ready: true,
    present: true,
    docker: true,
    reason: undefined,
  }

  function Home({ desktop, onValue }: { desktop: Desktop; onValue: (home: EThreadHome) => void }) {
    onValue(useThreadHome({ threadId: 'brn_1', desktop }).home)
    return null
  }
  const homeOf = async (desktop: Desktop) => {
    let latest: EThreadHome | undefined
    await mount(<Home desktop={desktop} onValue={(value) => (latest = value)} />)
    return latest
  }

  it('routes a thread in the shared-home summary index to This Mac', async () => {
    routes['GET /desktop/threads'] = () => Response.json({ threads: [localSummary] })
    expect(await homeOf(present)).toBe(EThreadHome.ThisMac)
  })

  it('keeps unknown threads on Cloud', async () => {
    routes['GET /desktop/threads'] = () => Response.json({ threads: [] })
    expect(await homeOf(present)).toBe(EThreadHome.Cloud)
  })

  it('never asks the host without desktop', async () => {
    expect(
      await homeOf({
        ready: true,
        present: false,
        docker: false,
        reason: undefined,
      }),
    ).toBe(EThreadHome.Cloud)
    expect(calls).toEqual([])
  })

  it('keeps a stopped pod passive during mint', async () => {
    routes['GET /desktop/pods/brn_1'] = () => Response.json(pod('stopped'))
    expect(await mintLocalPod('brn_1')).toEqual({ outcome: EPodConnectOutcome.NotRunning })
    expect(calls.map((call) => call.path)).toEqual(['/desktop/pods/brn_1'])
  })

  it('reports not-running on 409 pod-not-running', async () => {
    routes['GET /desktop/pods/brn_1'] = () => Response.json(pod())
    routes['POST /desktop/pods/brn_1/connect'] = () =>
      Response.json({ code: 'pod-not-running' }, { status: 409 })
    expect(await mintLocalPod('brn_1')).toEqual({
      outcome: EPodConnectOutcome.NotRunning,
    })
  })

  it('merges local thread summaries into their project with a local runner', () => {
    const entries = [
      { project: { id: 'p1' }, sessions: [] },
      { project: { id: 'p2' }, sessions: [] },
    ]
    const merged = withLocalThreads({
      entries,
      threads: [{ ...localSummary, projectId: 'p1' }],
    })
    expect(merged[0]?.sessions[0]?.mainThread.id).toBe('brn_1')
    expect(merged[0]?.sessions[0]?.mainThread.runner).toBe('local')
    expect(merged[1]?.sessions).toEqual([])
    expect(localThreadOf({ ...localSummary, projectId: 'p1' }).projectId).toBe('p1')
  })
})

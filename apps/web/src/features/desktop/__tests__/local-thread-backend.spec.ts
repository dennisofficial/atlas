import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'

import { EPodState } from '@dltech/atlas-wire/web'

import { EPodConnectOutcome } from '@/features/threads/data/pod-connect'
import { cloudThreadBackend } from '@/features/threads/data/thread-backend'

import { resetDesktopCapabilities } from '../desktop-wire'
import { holdFirstMessage } from '../first-message'
import { localThreadBackend, NOT_CONNECTED, UNSUPPORTED_ON_MAC } from '../local-thread-backend'
import { invalidateLocalThreadHistory } from '../local-thread-history'
import { localEvent, localSummary } from './local-thread-fixture'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())
const realFetch = globalThis.fetch
let calls: string[]
let state: string
const ticket = { url: 'ws://127.0.0.1:1/', token: 't', expiresAt: '2026-10-29T10:00:00.000Z' }

beforeEach(() => {
  calls = []
  state = 'running'
  Reflect.set(window, 'atlasDesktop', {})
  invalidateLocalThreadHistory()
  resetDesktopCapabilities()
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const path = String(input)
      const call = `${init?.method ?? 'GET'} ${path}`
      calls.push(call)
      const pod = { threadId: 'brn_1', projectId: 'p1', createdAt: localSummary.createdAt, state }
      if (path === '/desktop/threads') return Response.json({ threads: [localSummary] })
      if (path.includes('/events?'))
        return Response.json({ events: [localEvent(3)], head: 3, nextAfter: null })
      if (path.endsWith('/status'))
        return Response.json({ state: state === 'running' ? 'running' : 'parked', steps: [] })
      if (path.endsWith('/connect')) return Response.json(ticket)
      if (path.endsWith('/wake')) return Response.json({ ...pod, state: 'running' })
      return Response.json(pod)
    },
    { preconnect: realFetch.preconnect },
  )
})
afterEach(() => {
  globalThis.fetch = realFetch
  Reflect.deleteProperty(window, 'atlasDesktop')
  invalidateLocalThreadHistory()
})

describe('localThreadBackend', () => {
  it('is local and the cloud backend is not', () => {
    expect(localThreadBackend.local).toBe(true)
    expect(cloudThreadBackend.local).toBe(false)
  })

  it('mints through /desktop connect', async () => {
    expect(await localThreadBackend.mint('brn_1')).toEqual({
      outcome: EPodConnectOutcome.Ready,
      ticket,
    })
    expect(calls).toContain('POST /desktop/pods/brn_1/connect')
  })

  it('reads truthful stored metadata and stopped pod status without waking', async () => {
    state = 'stopped'
    expect(await localThreadBackend.fetchThread('brn_1')).toMatchObject({
      id: 'brn_1',
      runner: 'local',
      head: 3,
      updatedAt: localSummary.updatedAt,
      status: localSummary.status,
      model: { ref: localSummary.model, effort: localSummary.effort },
    })
    expect((await localThreadBackend.fetchPod('brn_1')).state).toBe(EPodState.Parked)
    expect(calls).toEqual(['GET /desktop/threads', 'GET /desktop/pods/brn_1/status'])
  })

  it('shares concurrent full seeds from the shared home without retaining a completed read', async () => {
    const seeds = await Promise.all([
      localThreadBackend.fetchSeed('brn_1'),
      localThreadBackend.fetchSeed('brn_1'),
    ])
    expect(seeds).toEqual([[localEvent(3)], [localEvent(3)]])
    expect(calls).toEqual(['GET /desktop/threads/brn_1/events?after=0&limit=500'])
    expect(await localThreadBackend.fetchSeed('brn_1')).toEqual([localEvent(3)])
    expect(calls).toEqual([
      'GET /desktop/threads/brn_1/events?after=0&limit=500',
      'GET /desktop/threads/brn_1/events?after=0&limit=500',
    ])
  })

  it('only explicit wake posts wake and then connects', async () => {
    state = 'stopped'
    expect(await localThreadBackend.wake?.('brn_1')).toEqual({
      outcome: EPodConnectOutcome.Ready,
      ticket,
    })
    expect(calls).toEqual(['POST /desktop/pods/brn_1/wake', 'POST /desktop/pods/brn_1/connect'])
  })

  it('never posts over the cloud api', async () => {
    await expect(
      localThreadBackend.postMessage({ threadId: 'a', sendId: 'b', text: 'c' }),
    ).rejects.toThrow(NOT_CONNECTED)
    await expect(
      localThreadBackend.rewind({ threadId: 'a', toSeq: 1, cutAgents: [] }),
    ).rejects.toThrow(UNSUPPORTED_ON_MAC)
  })

  it('delivers the held first message once live', () => {
    holdFirstMessage({ threadId: 'brn_9', text: 'hi', sendId: 's1' })
    const sent: unknown[] = []
    localThreadBackend.afterConnect({
      threadId: 'brn_9',
      send: (message) => {
        sent.push(message)
        return true
      },
    })
    expect(sent).toEqual([{ text: 'hi', requestId: 's1' }])
  })
})

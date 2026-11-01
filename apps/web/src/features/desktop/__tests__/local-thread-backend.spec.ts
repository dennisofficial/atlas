import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EPodState } from '@dltech/atlas-wire/web'

import { EThreadStatus, threadStatusOf } from '@/features/shell/thread-status'
import { EPodConnectOutcome } from '@/features/threads/data/pod-connect'
import { cloudThreadBackend } from '@/features/threads/data/thread-backend'

import { resetDesktopCapabilities } from '../desktop-wire'
import { holdFirstMessage } from '../first-message'
import { localThreadBackend, NOT_CONNECTED, UNSUPPORTED_ON_MAC } from '../local-thread-backend'

const realFetch = globalThis.fetch
let calls: string[]
let state: string

const ticket = {
  url: 'ws://127.0.0.1:1/',
  token: 't',
  expiresAt: '2026-10-29T10:00:00.000Z',
}

beforeEach(() => {
  calls = []
  state = 'running'
  resetDesktopCapabilities()
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const call = `${init?.method ?? 'GET'} ${String(input)}`
      calls.push(call)
      const pod = {
        threadId: 'brn_1',
        projectId: 'p1',
        createdAt: '2026-10-29T10:00:00.000Z',
        state,
      }
      if (call.endsWith('/connect')) return Response.json(ticket)
      if (call.endsWith('/wake')) return Response.json({ ...pod, state: 'running' })
      return Response.json(pod)
    },
    { preconnect: realFetch.preconnect },
  )
})
afterEach(() => {
  globalThis.fetch = realFetch
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

  it('reads the thread and pod from /desktop and wakes a stopped pod', async () => {
    state = 'stopped'
    expect((await localThreadBackend.fetchThread('brn_1')).runner).toBe('local')
    expect((await localThreadBackend.fetchPod('brn_1')).state).toBe(EPodState.Running)
    expect(calls).toContain('POST /desktop/pods/brn_1/wake')
  })

  it.each([
    { hostState: 'running', sidebarStatus: EThreadStatus.Idle },
    { hostState: 'stopped', sidebarStatus: EThreadStatus.Parked },
    { hostState: 'missing', sidebarStatus: EThreadStatus.Failed },
  ])(
    'reads $hostState status locally without waking or calling Cloud',
    async ({ hostState, sidebarStatus }) => {
      state = hostState
      const thread = await localThreadBackend.fetchThread('brn_1')

      expect(threadStatusOf(thread)).toBe(sidebarStatus)
      expect(calls).toEqual(['GET /desktop/pods/brn_1'])
    },
  )

  it('seeds empty so the channel replays history from seq 0', async () => {
    expect(await localThreadBackend.fetchEvents('brn_1')).toEqual([])
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

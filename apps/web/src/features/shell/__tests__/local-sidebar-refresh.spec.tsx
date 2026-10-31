import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import { createLocalThreadFeed } from '@/features/desktop/local-thread-feed'
import {
  ELocalActivityState,
  listLocalThreads,
  type LocalThread,
} from '@/features/desktop/local-thread-wire'
import { withLocalThreads } from '@/features/desktop/local-thread'
import { usePageVisible } from '@/lib/use-page-visible'

import { createLocalEntriesLoader } from '../load-shell-entries'
import { EThreadStatus, isUnread, threadStatusOf } from '../thread-status'
import { useLocalListSignals } from '../use-local-list-signals'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const realFetch = globalThis.fetch
let root: ReturnType<typeof createRoot> | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  globalThis.fetch = realFetch
  Reflect.deleteProperty(window, 'atlasDesktop')
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('passive native sidebar refresh', () => {
  it('refreshes host title, head, status and read cursor during a Cloud outage without waking', async () => {
    Reflect.set(window, 'atlasDesktop', {})
    let stored: LocalThread = {
      activityState: ELocalActivityState.Available,
      lastAssistantSeq: 17,
      threadId: 'local-1',
      projectId: null,
      title: 'Stored title',
      head: 29,
      readSeq: 5,
      createdAt: '2026-10-24T10:00:00.000Z',
      updatedAt: '2026-10-30T12:00:00.000Z',
      status: {
        working: false,
        awaiting: null,
        lastOutcome: null,
        podState: 'parked',
        lastAssistantSeq: 17,
        readSeq: 5,
      },
    }
    const calls: { path: string; method: string }[] = []
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        calls.push({ path: String(input), method: init?.method ?? 'GET' })
        return Response.json({ threads: [stored] })
      },
      { preconnect: realFetch.preconnect },
    )
    let tick: (() => void) | undefined
    const feed = createLocalThreadFeed({
      schedule: ({ run }) => {
        tick = run
        return () => {
          tick = undefined
        }
      },
    })
    const load = createLocalEntriesLoader({ load: listLocalThreads })
    let loaded: ReturnType<typeof withLocalThreads> | undefined
    const reload = () => {
      void load().then((value) => {
        loaded = withLocalThreads({ entries: [], threads: value.threads })
      })
    }
    function Probe() {
      useLocalListSignals({ visible: usePageVisible(), subscribe: feed.subscribeChanges, reload })
      return null
    }
    root = createRoot(document.createElement('div'))
    await act(async () => root?.render(<Probe />))
    const first = loaded?.[0]?.sessions[0]?.mainThread
    expect(first).toMatchObject({ title: 'Stored title', head: 29 })
    expect(first && isUnread({ thread: first, active: false })).toBe(true)

    stored = {
      ...stored,
      head: 35,
      lastAssistantSeq: 33,
      title: 'Renamed on host',
      status: { ...stored.status, working: true, podState: 'running', lastAssistantSeq: 33 },
    }
    await act(async () => tick?.())
    const running = loaded?.[0]?.sessions[0]?.mainThread
    expect(running).toMatchObject({ title: 'Renamed on host', head: 35 })
    expect(running && threadStatusOf(running)).toBe(EThreadStatus.Running)

    stored = { ...stored, readSeq: 35, status: { ...stored.status, working: false, readSeq: 35 } }
    await act(async () => tick?.())
    const read = loaded?.[0]?.sessions[0]?.mainThread
    expect(read?.status?.readSeq).toBe(35)
    expect(read && isUnread({ thread: read, active: false })).toBe(false)
    expect(read && threadStatusOf(read)).toBe(EThreadStatus.Idle)
    expect(calls.every((call) => call.path === '/desktop/threads' && call.method === 'GET')).toBe(
      true,
    )

    const lateTick = tick
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(tick).toBeUndefined()
    const readsBeforeHiddenTick = calls.length
    await act(async () => lateTick?.())
    expect(calls).toHaveLength(readsBeforeHiddenTick)
  })
})

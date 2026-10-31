import { describe, expect, it } from 'bun:test'

import { createShellEntriesLoader, loadShellEntries, shellEntriesOf } from '../load-shell-entries'
import { DesktopError } from '@/features/desktop/desktop-http'
import { localThreadOf } from '@/features/desktop/local-thread'
import { sessionOf, threadOf } from './fixtures'

const summary = () => ({
  threadId: 'local-1',
  projectId: null,
  head: 29,
  readSeq: 5,
  createdAt: '2026-10-24T10:00:00.000Z',
  updatedAt: '2026-10-30T12:00:00.000Z',
  status: {
    working: false,
    awaiting: null,
    lastOutcome: null,
    podState: 'parked' as const,
    lastAssistantSeq: 17,
    readSeq: 5,
  },
})

describe('shell entries loader', () => {
  it('retains native roots and deduplication on host failure while accepting fresh Cloud entries', async () => {
    let unavailable = false
    const failure = new DesktopError({ message: 'Host unavailable', status: 503 })
    const load = createShellEntriesLoader({
      cloud: async () => [
        {
          project: null,
          sessions: [
            sessionOf(threadOf({ id: 'local-1', title: 'Cloud mirror' })),
            sessionOf(threadOf({ id: unavailable ? 'new-cloud' : 'old-cloud' })),
          ],
        },
      ],
      local: async () => {
        if (unavailable) throw failure
        return [summary()]
      },
    })
    await load()
    unavailable = true
    const loaded = await load()
    expect(
      loaded.entries[0]?.sessions.map((session) => ({
        id: session.mainThread.id,
        runner: session.mainThread.runner,
      })),
    ).toEqual([
      { id: 'new-cloud', runner: undefined },
      { id: 'local-1', runner: 'local' },
    ])
    expect(loaded.localError).toBe(failure)
    expect(loaded.cloudError).toBeNull()
  })

  it('forgets a successfully empty local snapshot even if Cloud fails on that refresh', async () => {
    let phase = 0
    const cloudFailure = new Error('Cloud unavailable')
    const localFailure = new DesktopError({ message: 'Host unavailable', status: 503 })
    const load = createShellEntriesLoader({
      cloud: async () => {
        if (phase === 1) throw cloudFailure
        return []
      },
      local: async () => {
        if (phase === 2) throw localFailure
        return phase === 0 ? [summary()] : []
      },
    })
    await load()
    phase = 1
    await expect(load()).rejects.toBe(cloudFailure)
    phase = 2
    const unavailable = await load()
    expect(unavailable.entries).toEqual([])
    expect(unavailable.localThreads).toEqual([])
    expect(unavailable.localError).toBe(localFailure)
  })

  it('keeps native host status authoritative while retaining Cloud activity overrides', () => {
    const local = localThreadOf(summary())
    const cloud = threadOf({ id: 'cloud', status: { ...summary().status, lastAssistantSeq: 0 } })
    const merged = shellEntriesOf({
      entries: [{ project: null, sessions: [sessionOf(local), sessionOf(cloud)] }],
      created: [],
      overrides: new Map(
        ['local-1', 'cloud'].map((id) => [
          id,
          {
            activity: { working: true },
            at: 1,
            pending: true,
          },
        ]),
      ),
    })
    expect(merged[0]?.sessions[0]?.mainThread.status).toEqual(summary().status)
    expect(merged[0]?.sessions[1]?.mainThread.status?.working).toBe(true)
  })

  it('lists local roots even when Cloud project discovery fails', async () => {
    const failure = new Error('Cloud unavailable')
    const loaded = await loadShellEntries({
      cloud: async () => {
        throw failure
      },
      local: async () => [summary()],
    })
    expect(loaded.entries).toMatchObject([
      { project: null, sessions: [{ mainThread: { id: 'local-1', head: 29 } }] },
    ])
  })

  it('starts native discovery before Cloud project discovery settles', async () => {
    let rejectCloud: ((reason: Error) => void) | undefined
    const cloud = new Promise<never>((_resolve, reject) => {
      rejectCloud = reject
    })
    let localStarted = false
    const pending = loadShellEntries({
      cloud: () => cloud,
      local: async () => {
        localStarted = true
        return [summary()]
      },
    })
    expect(localStarted).toBe(true)
    rejectCloud?.(new Error('offline'))
    expect((await pending).entries[0]?.sessions[0]?.mainThread.id).toBe('local-1')
  })

  it('preserves the original Cloud-only error when no local roots exist', async () => {
    const failure = new Error('Cloud unavailable')
    await expect(
      loadShellEntries({
        cloud: async () => {
          throw failure
        },
        local: async () => [],
      }),
    ).rejects.toBe(failure)
  })

  it('removes retained native roots only after a successful empty local response', async () => {
    let empty = false
    const load = createShellEntriesLoader({
      cloud: async () => [{ project: null, sessions: [sessionOf(threadOf({ id: 'cloud' }))] }],
      local: async () => (empty ? [] : [summary()]),
    })
    await load()
    empty = true
    const loaded = await load()
    expect(loaded.entries[0]?.sessions.map((session) => session.mainThread.id)).toEqual(['cloud'])
    expect(loaded.localThreads).toEqual([])
    expect(loaded.localError).toBeNull()
  })

  it('exposes an initial unavailable native host without discarding successful Cloud results', async () => {
    const entries = [{ project: null, sessions: [] }]
    const failure = new DesktopError({ message: 'Host unavailable', status: 503 })
    const loaded = await loadShellEntries({
      cloud: async () => entries,
      local: async () => {
        throw failure
      },
    })
    expect(loaded.entries).toBe(entries)
    expect(loaded.localThreads).toEqual([])
    expect(loaded.localError).toBe(failure)
    expect(loaded.cloudError).toBeNull()
  })

  it('preserves both failure classifications with and without a known local snapshot', async () => {
    let unavailable = false
    const localFailure = new DesktopError({ message: 'Host unavailable', status: 503 })
    const cloudFailure = new Error('Cloud unavailable')
    const cloud = async () => {
      throw cloudFailure
    }
    const local = async () => {
      if (unavailable) throw localFailure
      return [summary()]
    }
    const load = createShellEntriesLoader({ cloud, local })
    await load()
    unavailable = true
    const retained = await load()
    expect(retained.entries[0]?.sessions[0]?.mainThread.id).toBe('local-1')
    expect(retained.localError).toBe(localFailure)
    expect(retained.cloudError).toBe(cloudFailure)
    const initial = await loadShellEntries({ cloud, local })
    expect(initial.entries).toEqual([])
    expect(initial.localError).toBe(localFailure)
    expect(initial.cloudError).toBe(cloudFailure)
  })
})

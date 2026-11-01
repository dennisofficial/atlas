import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { ERunner } from '@dltech/atlas-core'

import { DesktopError } from '@/features/desktop/desktop-wire'
import { localThreadOf, withLocalThreads } from '@/features/desktop/local-thread'
import { localThreadSchema } from '@/features/desktop/local-thread-wire'
import { fakeFetch, mutationUrl, trpcOk } from '@/features/threads/data/__tests__/trpc-fake'
import { archiveThread } from '../archive-thread'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())
const realFetch = globalThis.fetch
beforeEach(() => {
  Reflect.set(window, 'atlasDesktop', {})
})
afterEach(() => {
  globalThis.fetch = realFetch
  Reflect.deleteProperty(window, 'atlasDesktop')
})

describe('archive runner dispatch', () => {
  it('archives and restores local records through the Mac route only', async () => {
    const calls = fakeFetch(() => new Response(null, { status: 204 }))
    for (const archived of [true, false]) {
      await archiveThread({ threadId: 'local/id', archived, runner: ERunner.Local })
    }
    expect(calls).toEqual(
      [true, false].map((archived) => ({
        url: '/desktop/threads/local%2Fid/archive',
        method: 'POST',
        body: { archived },
      })),
    )
  })

  it('never reaches the Mac route from a hosted browser', async () => {
    Reflect.deleteProperty(window, 'atlasDesktop')
    const calls = fakeFetch(() => new Response(null, { status: 204 }))
    await expect(
      archiveThread({ threadId: 'local', archived: true, runner: ERunner.Local }),
    ).rejects.toThrow('requires the Atlas Mac app')
    expect(calls).toEqual([])
  })

  it('keeps cloud and legacy threads on the existing API', async () => {
    const calls = fakeFetch(() => trpcOk(undefined))
    for (const runner of [ERunner.Vercel, undefined]) {
      await archiveThread({ threadId: 'cloud', archived: true, runner })
    }
    expect(calls).toEqual(
      [0, 1].map(() => ({
        url: mutationUrl('threads.archive'),
        method: 'POST',
        body: { threadId: 'cloud', archived: true },
      })),
    )
  })

  it('propagates a local missing-ID failure rather than falling back to cloud', async () => {
    const calls = fakeFetch(() => Response.json({ code: 'not-found' }, { status: 404 }))
    await expect(
      archiveThread({ threadId: 'missing', archived: false, runner: ERunner.Local }),
    ).rejects.toBeInstanceOf(DesktopError)
    expect(calls).toHaveLength(1)
  })

  it('retains archived local threads in sidebar projections after reload', () => {
    const base = {
      threadId: 'local',
      projectId: 'p',
      head: 3,
      lastAssistantSeq: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      archivedAt: '2026-02-01T00:00:00.000Z',
    }
    const thread = localThreadSchema.parse({
      ...base,
      activityState: 'unavailable',
      reason: 'Activity unsupported',
    })
    expect(localThreadOf(thread).archivedAt).toBe(base.archivedAt)
    const entries = withLocalThreads({
      entries: [{ project: { id: 'p' }, sessions: [] }],
      threads: [thread],
    })
    expect(entries[0]?.sessions[0]?.mainThread.archivedAt).toBe(base.archivedAt)
    expect(localThreadOf({ ...thread, archivedAt: null }).archivedAt).toBeNull()
  })
})

import { afterEach, describe, expect, it } from 'bun:test'
import { ERunner } from '@dltech/atlas-core'

import { localPodSchema, ELocalPodState, DesktopError } from '@/features/desktop/desktop-wire'
import { localThreadOf, withLocalPods } from '@/features/desktop/local-thread'
import { fakeFetch, mutationUrl, trpcOk } from '@/features/threads/data/__tests__/trpc-fake'
import { archiveThread } from '../archive-thread'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
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

  it('retains archived local pods in sidebar projections after reload', () => {
    const pod = localPodSchema.parse({
      threadId: 'local',
      projectId: 'p',
      createdAt: '2026-01-01T00:00:00.000Z',
      state: ELocalPodState.Stopped,
      archivedAt: '2026-02-01T00:00:00.000Z',
    })
    expect(localThreadOf(pod).archivedAt).toBe(pod.archivedAt)
    const entries = withLocalPods({
      entries: [{ project: { id: 'p' }, sessions: [] }],
      pods: [pod],
    })
    expect(entries[0]?.sessions[0]?.mainThread.archivedAt).toBe(pod.archivedAt)
    expect(localThreadOf({ ...pod, archivedAt: null }).archivedAt).toBeNull()
  })
})

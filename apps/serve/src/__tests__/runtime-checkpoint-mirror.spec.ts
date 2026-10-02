import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { transcriptIdentityDigest } from '@dltech/atlas-harness'
import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import type { ServeLogLine } from '../serve-log'
import { captureFor, fakeFetch, saidEvent, startApi, threadId } from './runtime-checkpoint-fixture'

const homes: string[] = []
const servers: ReturnType<typeof Bun.serve>[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  for (const server of servers.splice(0)) void server.stop(true)
})

const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-checkpoint-spec-'))
  homes.push(home)
  return home
}

describe('runtime checkpoint mirror', () => {
  it('mirrors a capture to the API it was given', async () => {
    const home = scratchHome()
    const events = [saidEvent({ id: 'a', seq: 1 }), saidEvent({ id: 'b', seq: 2 })]
    const published: RuntimeCheckpoint[] = []
    let stored: RuntimeCheckpoint | null = null
    const server = startApi({
      stored: () => stored,
      publish: (checkpoint) => {
        published.push(checkpoint)
        stored = checkpoint
      },
    })
    servers.push(server)
    const capture = captureFor({ home, events, cloudURL: `http://127.0.0.1:${server.port}` })

    const checkpoint = await capture.capture({ phase: ERuntimePhase.Running })
    expect(checkpoint?.transcript.digest).toBe(transcriptIdentityDigest(events))
    await capture.flush({ timeoutMs: 1_000 })
    expect(published).toEqual([checkpoint as RuntimeCheckpoint])
  })

  it('persists before the mirror is asked', async () => {
    const home = scratchHome()
    let sawPersistedBeforeSend = false
    const send: { release: ((response: Response) => void) | null } = { release: null }
    const entered: { notify: () => void } = { notify: () => undefined }
    const fetchEntered = new Promise<void>((resolve) => {
      entered.notify = resolve
    })
    const capture = captureFor({
      home,
      cloudURL: 'http://127.0.0.1:9',
      fetchFn: fakeFetch(async () => {
        sawPersistedBeforeSend = (await capture.readPersisted()) !== null
        entered.notify()
        return await new Promise<Response>((resolve) => {
          send.release = resolve
        })
      }),
    })

    const sent = capture.capture({ phase: ERuntimePhase.Running })
    await fetchEntered
    expect(sawPersistedBeforeSend).toBe(true)
    send.release?.(new Response('{}', { status: 200 }))
    await sent
    await capture.flush({ timeoutMs: 1_000 })
  })

  it('serializes mirrors and coalesces a burst to the newest checkpoint', async () => {
    const home = scratchHome()
    const sentRevisions: number[] = []
    let gate: (() => void) | null = null
    const holdFirst = (): Promise<void> =>
      new Promise<void>((resolve) => {
        gate = resolve
      })
    const releaseFirst = (): void => {
      gate?.()
      gate = () => undefined
    }
    const capture = captureFor({
      home,
      cloudURL: 'http://127.0.0.1:9',
      fetchFn: fakeFetch(async (_input: unknown, init?: RequestInit) => {
        if (sentRevisions.length === 0 && gate === null) await holdFirst()
        const body = JSON.parse(String(init?.body)) as RuntimeCheckpoint
        sentRevisions.push(body.revision)
        return new Response('{}', { status: 200 })
      }),
    })

    const batch = Promise.all([
      capture.capture({ phase: ERuntimePhase.Running }),
      capture.capture({ phase: ERuntimePhase.Running }),
      capture.capture({ phase: ERuntimePhase.Parked }),
    ])
    await new Promise((resolve) => setTimeout(resolve, 30))
    releaseFirst()
    await batch
    await capture.flush({ timeoutMs: 1_000 })
    expect(sentRevisions).toEqual([1, 3])
  })

  it('sends a parked mirror immediately, coalescing queued progress into the final report', async () => {
    const home = scratchHome()
    let clock = 1_000_000
    const sent: { revision: number; phase: string }[] = []
    const capture = captureFor({
      home,
      cloudURL: 'http://127.0.0.1:9',
      now: () => clock,
      fetchFn: fakeFetch(async (_input: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as RuntimeCheckpoint
        sent.push({ revision: body.revision, phase: body.phase })
        return new Response('{}', { status: 200 })
      }),
    })

    await capture.capture({ phase: ERuntimePhase.Running })
    capture.changed()
    capture.changed()
    const parked = await capture.capture({ phase: ERuntimePhase.Parked })
    capture.changed()
    await capture.flush({ timeoutMs: 1_000 })
    expect(sent).toEqual([
      { revision: 1, phase: 'running' },
      { revision: 3, phase: 'parked' },
    ])
    expect(parked?.phase).toBe(ERuntimePhase.Parked)
    expect(parked?.revision).toBe(3)
    await expect(capture.capture({ phase: ERuntimePhase.Running })).resolves.toBeNull()
    expect((await capture.readPersisted())?.revision).toBe(3)
  })

  it('drains cadence-deferred progress when captures stop inside the window', async () => {
    const home = scratchHome()
    const clock = 1_000_000
    const sent: { revision: number; phase: string }[] = []
    const capture = captureFor({
      home,
      cloudURL: 'http://127.0.0.1:9',
      now: () => clock,
      fetchFn: fakeFetch(async (_input: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as RuntimeCheckpoint
        sent.push({ revision: body.revision, phase: body.phase })
        return new Response('{}', { status: 200 })
      }),
    })

    await capture.capture({ phase: ERuntimePhase.Running })
    await capture.flush({ timeoutMs: 1_000 })
    expect(sent.map((entry) => entry.revision)).toEqual([1])

    await capture.capture({ phase: ERuntimePhase.Running })
    expect(sent.map((entry) => entry.revision)).toEqual([1])
    await new Promise((resolve) => setTimeout(resolve, 1_300))
    expect(sent.map((entry) => entry.revision)).toEqual([1, 2])
  })

  it('mirrors through a real API that rejects stale and same-revision publishers', async () => {
    const home = scratchHome()
    let stored: RuntimeCheckpoint | null = null
    const accepted: RuntimeCheckpoint[] = []
    const server = startApi({
      stored: () => stored,
      publish: (checkpoint) => {
        accepted.push(checkpoint)
        stored = checkpoint
      },
    })
    servers.push(server)
    const cloudURL = `http://127.0.0.1:${server.port}`

    const stale: RuntimeCheckpoint = {
      threadId,
      runtimeId: 'runtime-old',
      sandboxSessionId: 'sandbox-session-1',
      revision: 1,
      phase: ERuntimePhase.Parked,
      reportedAt: '2026-10-01T11:00:00.000Z',
      transcript: { head: 0, count: 0, digest: 'b'.repeat(64) },
    }
    const capture = captureFor({
      home,
      events: [saidEvent({ id: 'a', seq: 1 })],
      cloudURL,
    })
    await capture.capture({ phase: ERuntimePhase.Running })
    await capture.capture({ phase: ERuntimePhase.Parked })
    await capture.flush({ timeoutMs: 1_000 })
    expect(accepted.map((c) => c.revision)).toEqual([1, 2])

    const staleReply = await fetch(`${cloudURL}/v1/sandboxes/${threadId}/checkpoint`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(stale),
    })
    const staleBody = (await staleReply.json()) as { checkpoint: RuntimeCheckpoint | null }
    expect(staleBody.checkpoint?.revision).toBe(2)

    const getReply = await fetch(`${cloudURL}/v1/sandboxes/${threadId}/checkpoint`)
    const getBody = (await getReply.json()) as { checkpoint: RuntimeCheckpoint | null }
    expect(getBody.checkpoint?.phase).toBe(ERuntimePhase.Parked)
  })

  it('treats a missing registration as a logged diagnostic and retries on the next report', async () => {
    const home = scratchHome()
    const lines: ServeLogLine[] = []
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response('no row', { status: 404 }),
    })
    servers.push(server)
    const capture = captureFor({
      home,
      lines,
      cloudURL: `http://127.0.0.1:${server.port}`,
    })

    await capture.capture({ phase: ERuntimePhase.Running })
    await capture.flush({ timeoutMs: 1_000 })
    expect(lines.filter((line) => line.event === 'serve.checkpoint-mirror-failed')).toHaveLength(1)

    await capture.capture({ phase: ERuntimePhase.Running })
    await capture.flush({ timeoutMs: 1_000 })
    expect(lines.filter((line) => line.event === 'serve.checkpoint-mirror-failed')).toHaveLength(2)
  })

  it(
    'resolves flush on timeout without throwing while the mirror hangs',
    async () => {
      const home = scratchHome()
      const lines: ServeLogLine[] = []
      const capture = captureFor({
        home,
        lines,
        cloudURL: 'http://127.0.0.1:9',
        fetchFn: fakeFetch(
          (_input: unknown, init?: RequestInit) =>
            new Promise<Response>((resolve) => {
              init?.signal?.addEventListener('abort', () =>
                resolve(new Response(null, { status: 408 })),
              )
            }),
        ),
      })

      await capture.capture({ phase: ERuntimePhase.Running })
      await expect(capture.flush({ timeoutMs: 20 })).resolves.toBeUndefined()
      await capture.flush({ timeoutMs: 6_000 })
      expect(lines.some((line) => line.event === 'serve.checkpoint-mirror-failed')).toBe(true)
    },
    10_000,
  )
})

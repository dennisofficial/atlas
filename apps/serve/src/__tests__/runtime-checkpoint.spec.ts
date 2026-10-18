import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runtimeCheckpointFile } from '@dltech/atlas-harness'
import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import type { ServeLogLine } from '../serve-log'
import {
  captureFor,
  fakeFetch,
  SANDBOX_SESSION_ID_ENV,
  saidEvent,
  threadId,
} from './runtime-checkpoint-fixture'

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-checkpoint-spec-'))
  homes.push(home)
  return home
}

describe('createRuntimeCheckpointCapture', () => {
  it('persists a phase-tagged checkpoint of the transcript', async () => {
    const home = scratchHome()
    const events = [saidEvent({ id: 'a', seq: 1 }), saidEvent({ id: 'b', seq: 2 })]
    const capture = captureFor({ home, events })

    const checkpoint = await capture.capture({ phase: ERuntimePhase.Serving })
    expect(checkpoint).toMatchObject({
      threadId,
      revision: 1,
      phase: ERuntimePhase.Serving,
      transcript: { head: 2, count: 2 },
    })
    expect(checkpoint?.transcript.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(await capture.readPersisted()).toEqual(checkpoint)
  })

  it('continues the persisted revision across boots with a fresh runtimeId', async () => {
    const home = scratchHome()
    const first = captureFor({ home })
    const boot1 = await first.capture({ phase: ERuntimePhase.Serving })

    const second = captureFor({ home })
    const boot2 = await second.capture({ phase: ERuntimePhase.Serving })

    expect(boot1?.revision).toBe(1)
    expect(boot2?.revision).toBe(2)
    expect(boot2?.runtimeId).not.toBe(boot1?.runtimeId)
    expect(boot2?.sandboxSessionId).toBe(boot1?.sandboxSessionId)
  })

  it('overwrites an initial persisted park with running on the next boot', async () => {
    const home = scratchHome()
    const first = captureFor({ home })
    const parked = await first.capture({ phase: ERuntimePhase.Parked })

    const second = captureFor({ home })
    const running = await second.capture({ phase: ERuntimePhase.Serving })

    expect(parked?.phase).toBe(ERuntimePhase.Parked)
    expect(running?.phase).toBe(ERuntimePhase.Serving)
    expect(running?.revision).toBe((parked?.revision ?? 0) + 1)
    expect(await second.readPersisted()).toEqual(running)
  })

  it('rejects and never publishes when the durable persist fails', async () => {
    const home = scratchHome()
    const lines: ServeLogLine[] = []
    const fetchCalls: string[] = []
    const fs = await import('node:fs/promises')
    await fs.mkdir(runtimeCheckpointFile({ atlasHome: home }), { recursive: true })
    const capture = captureFor({
      home,
      lines,
      cloudURL: 'http://127.0.0.1:9',
      fetchFn: fakeFetch(async (input: unknown) => {
        fetchCalls.push(String(input))
        return new Response('{}', { status: 200 })
      }),
    })

    await expect(capture.capture({ phase: ERuntimePhase.Parked })).rejects.toThrow()
    await capture.flush({ timeoutMs: 1_000 })
    expect(fetchCalls).toHaveLength(0)
    expect(lines.some((line) => line.event === 'serve.checkpoint-persist-failed')).toBe(true)
  })

  it('distinguishes a rewind and a same-head replacement by digest', async () => {
    const home = scratchHome()
    const full = [saidEvent({ id: 'a', seq: 1 }), saidEvent({ id: 'b', seq: 2 })]
    const capture = captureFor({ home, events: full })
    const before = await capture.capture({ phase: ERuntimePhase.Serving })

    const rewound = captureFor({ home, events: [full[0]!] })
    const afterRewind = await rewound.capture({ phase: ERuntimePhase.Serving })
    expect(afterRewind?.transcript.head).toBe(1)
    expect(afterRewind?.transcript.digest).not.toBe(before?.transcript.digest)

    const replaced = captureFor({
      home,
      events: [full[0]!, saidEvent({ id: 'c', seq: 2, text: 'different' })],
    })
    const afterReplace = await replaced.capture({ phase: ERuntimePhase.Serving })
    expect(afterReplace?.transcript.head).toBe(before?.transcript.head)
    expect(afterReplace?.transcript.digest).not.toBe(before?.transcript.digest)
  })

  it('seals on parked and on updating alike: the finalized runtime never captures again', async () => {
    for (const [finalPhase, extra] of [
      [ERuntimePhase.Parked, {}],
      [ERuntimePhase.Updating, { resume: { parent: true } }],
    ] as const) {
      const home = scratchHome()
      const capture = captureFor({ home })
      await capture.capture({ phase: ERuntimePhase.Serving })
      if (finalPhase !== ERuntimePhase.Updating) {
        await capture.capture({ phase: ERuntimePhase.Parking, attempts: 1 })
      }
      const sealed = await capture.capture({ phase: finalPhase, ...extra })
      expect(sealed?.phase).toBe(finalPhase)
      if (finalPhase === ERuntimePhase.Updating && sealed?.phase === ERuntimePhase.Updating) {
        expect(sealed.receipt.checkpoint.revision).toBe(sealed.revision)
        expect(sealed.receipt.threadId).toBe(threadId)
      }
      await expect(capture.capture({ phase: ERuntimePhase.Serving })).resolves.toBeNull()
    }
  })

  it('fails safe when the persisted checkpoint is corrupt: no reset, no publish', async () => {
    const home = scratchHome()
    const lines: ServeLogLine[] = []
    const first = captureFor({ home, lines })
    await first.capture({ phase: ERuntimePhase.Serving })
    writeFileSync(runtimeCheckpointFile({ atlasHome: home }), '{"revision":')

    const second = captureFor({ home, lines })
    await expect(second.capture({ phase: ERuntimePhase.Parked })).rejects.toThrow(/unreadable/)
    expect(await second.readPersisted()).toBeNull()
  })

  it('returns null and never persists nor mirrors without a sandbox session id', async () => {
    const home = scratchHome()
    const lines: ServeLogLine[] = []
    const fetchCalls: string[] = []
    const capture = captureFor({
      home,
      lines,
      env: { [SANDBOX_SESSION_ID_ENV]: '' },
      cloudURL: 'http://127.0.0.1:9',
      fetchFn: fakeFetch(async (input: unknown) => {
        fetchCalls.push(String(input))
        return new Response('{}', { status: 200 })
      }),
    })

    await expect(capture.capture({ phase: ERuntimePhase.Serving })).resolves.toBeNull()
    await expect(capture.capture({ phase: ERuntimePhase.Parked })).resolves.toBeNull()
    expect(await capture.readPersisted()).toBeNull()
    await capture.flush({ timeoutMs: 1_000 })
    expect(fetchCalls).toHaveLength(0)
    expect(lines.some((line) => line.event === 'serve.checkpoint-unpublishable')).toBe(true)
  })

  it('short-circuits before any I/O without a session id: a throwing transcript is never read, prior checkpoint unread', async () => {
    const home = scratchHome()
    const seeded = captureFor({ home })
    await seeded.capture({ phase: ERuntimePhase.Serving })
    expect(await seeded.readPersisted()).not.toBeNull()

    const sessionless = captureFor({
      home,
      env: { [SANDBOX_SESSION_ID_ENV]: '' },
      transcript: {
        read: () => {
          throw new Error('the transcript must not be read without a session id')
        },
      },
    })
    expect(await sessionless.readPersisted()).toBeNull()
    await expect(sessionless.capture({ phase: ERuntimePhase.Serving })).resolves.toBeNull()
  })

  it('leaves no transcript artifacts: the only write is the operational checkpoint file', async () => {
    const home = scratchHome()
    const capture = captureFor({ home, events: [saidEvent({ id: 'a', seq: 1 })] })
    await capture.capture({ phase: ERuntimePhase.Serving })

    const fs = await import('node:fs/promises')
    expect(await fs.readdir(home)).toEqual(['operational'])
    expect(await fs.readdir(join(home, 'operational'))).toEqual(['runtime-checkpoint.json'])
  })

  it('serializes concurrent captures in revision order without interleaving', async () => {
    const home = scratchHome()
    const capture = captureFor({ home })
    const batch = await Promise.all([
      capture.capture({ phase: ERuntimePhase.Serving }),
      capture.capture({ phase: ERuntimePhase.Serving }),
      capture.capture({ phase: ERuntimePhase.Parking, attempts: 1 }),
      capture.capture({ phase: ERuntimePhase.Parked }),
      capture.capture({ phase: ERuntimePhase.Serving }),
    ])
    expect(batch.map((c) => c?.revision ?? null)).toEqual([1, 2, 3, 4, null])
    expect(batch[3]?.phase).toBe(ERuntimePhase.Parked)
    expect((await capture.readPersisted())?.revision).toBe(4)
  })
})

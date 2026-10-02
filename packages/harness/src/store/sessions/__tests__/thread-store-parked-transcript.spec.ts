import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId } from '@dltech/atlas-core'
import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import type { ParkedTranscriptRecord } from '../../../cloud/transcript-freshness'
import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { readMetaSync, threadMetaSchema } from '../meta'
import { sessionDirectory, threadMetaFile } from '../paths'
import { SessionRegistry } from '../registry'
import { JsonlThreadStore } from '../thread-store'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-parked-transcript-'))
  directories.push(dir)
  return dir
}

function openStore({ home }: { home: string }): JsonlThreadStore {
  const registry = new SessionRegistry(home)
  const clock = new SteppingClock()
  const ids = new CountingIds('spec')
  const log = new JsonlEventLog(home, registry, clock, ids)
  return new JsonlThreadStore(home, registry, clock, ids, log)
}

const checkpoint = (overrides: Partial<RuntimeCheckpoint> = {}): RuntimeCheckpoint => ({
  threadId: 'spec-1',
  runtimeId: 'runtime-1',
  sandboxSessionId: 'session-a',
  revision: 3,
  phase: ERuntimePhase.Parked,
  reportedAt: '2026-10-01T00:00:00.000Z',
  transcript: { head: 42, count: 42, digest: 'a'.repeat(64) },
  ...overrides,
})

const record = (): ParkedTranscriptRecord => ({
  checkpoint: checkpoint(),
  applied: { head: 42, count: 42, digest: 'a'.repeat(64) },
})

describe('the parked-transcript record of a thread', () => {
  it('round-trips through the store', async () => {
    const home = await tempHome()
    const threads = openStore({ home })
    const thread = await threads.create({ workspace: '/here' })
    const written = record()

    await threads.writeParkedTranscript({ threadId: thread.id, record: written })

    expect(await threads.readParkedTranscript({ threadId: thread.id })).toEqual(written)
  })

  it('keeps a null applied snapshot distinct from never being written', async () => {
    const home = await tempHome()
    const threads = openStore({ home })
    const thread = await threads.create({ workspace: '/here' })

    expect(await threads.readParkedTranscript({ threadId: thread.id })).toBeNull()

    await threads.writeParkedTranscript({
      threadId: thread.id,
      record: { checkpoint: checkpoint(), applied: null },
    })

    expect(await threads.readParkedTranscript({ threadId: thread.id })).toEqual({
      checkpoint: checkpoint(),
      applied: null,
    })
  })

  it('replaces the held record on the next write', async () => {
    const home = await tempHome()
    const threads = openStore({ home })
    const thread = await threads.create({ workspace: '/here' })
    const ahead = {
      checkpoint: checkpoint({ revision: 4, transcript: { head: 50, count: 50, digest: 'b'.repeat(64) } }),
      applied: { head: 50, count: 50, digest: 'b'.repeat(64) },
    }

    await threads.writeParkedTranscript({ threadId: thread.id, record: record() })
    await threads.writeParkedTranscript({ threadId: thread.id, record: ahead })

    expect(await threads.readParkedTranscript({ threadId: thread.id })).toEqual(ahead)
  })

  it('survives reparse of the meta file exactly as written', async () => {
    const home = await tempHome()
    const threads = openStore({ home })
    const thread = await threads.create({ workspace: '/here' })

    await threads.writeParkedTranscript({ threadId: thread.id, record: record() })

    const meta = readMetaSync({
      file: threadMetaFile({
        sessionDir: sessionDirectory({ home, sessionId: thread.id }),
        threadId: thread.id,
      }),
      schema: threadMetaSchema,
    })
    expect(meta?.parkedTranscript).toEqual(record())
  })

  it('reads null and swallows writes for a thread the store never heard of', async () => {
    const home = await tempHome()
    const threads = openStore({ home })
    const unknownId = toThreadId('spec-never-seen')

    await threads.writeParkedTranscript({ threadId: unknownId, record: record() })

    expect(await threads.readParkedTranscript({ threadId: unknownId })).toBeNull()
  })
})

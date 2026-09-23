import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toEventId, toRunId, toThreadId, type EventDraft, type EventEnvelope } from '@dltech/atlas-core'

import { EUnreadableReason } from '../../decode-events'
import { encodeEventLine, parseEventLines } from '../lines'
import { claimSession, ESessionClaim, releaseSession } from '../lock'
import { newThreadMeta, readMetaSync, readSessionMetaSync, sessionMetaSchema, SessionFromNewerAtlasError, threadMetaSchema, writeMeta } from '../meta'
import { sessionLockFile, sessionMetaFile, threadMetaFile } from '../paths'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-sessions-'))
  directories.push(dir)
  return dir
}

const threadId = toThreadId('brn_test-thread')

function draft(): EventDraft {
  return { type: 'nudge', text: 'hello', lifetimeSteps: 1 }
}

function envelope({ seq }: { seq: number }): EventEnvelope {
  return {
    id: toEventId(`evt_${seq}`),
    seq,
    threadId,
    runId: toRunId('run_1'),
    depth: 0,
    at: '2026-09-23T00:00:00.000Z',
  }
}

describe('event line codec', () => {
  it('round-trips a stamped event', () => {
    const line = encodeEventLine({ draft: draft(), envelope: envelope({ seq: 1 }) })
    const parsed = parseEventLines({ text: `${line}\n`, threadId })
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]?.seq).toBe(1)
    expect(parsed.unreadable).toHaveLength(0)
    expect(parsed.head).toBe(1)
  })

  it('treats a truncated final line as absent', () => {
    const first = encodeEventLine({ draft: draft(), envelope: envelope({ seq: 1 }) })
    const second = encodeEventLine({ draft: draft(), envelope: envelope({ seq: 2 }) })
    const text = `${first}\n${second.slice(0, second.length - 10)}`
    const parsed = parseEventLines({ text, threadId })
    expect(parsed.events).toHaveLength(1)
    expect(parsed.unreadable).toHaveLength(0)
    expect(parsed.head).toBe(1)
  })

  it('reports a mid-file malformed line as a gap', () => {
    const first = encodeEventLine({ draft: draft(), envelope: envelope({ seq: 1 }) })
    const second = encodeEventLine({ draft: draft(), envelope: envelope({ seq: 2 }) })
    const parsed = parseEventLines({ text: `${first}\n{not json\n${second}\n`, threadId })
    expect(parsed.events).toHaveLength(2)
    expect(parsed.unreadable).toHaveLength(1)
    expect(parsed.unreadable[0]?.reason).toBe(EUnreadableReason.MalformedJson)
  })

  it('reports an unrecognized body as a gap and keeps reading', () => {
    const good = encodeEventLine({ draft: draft(), envelope: envelope({ seq: 1 }) })
    const bad = JSON.stringify({ v: 1, id: 'evt_x', seq: 2, threadId, runId: 'run_1', depth: 0, at: 't', type: 'mystery', body: { nope: true } })
    const parsed = parseEventLines({ text: `${good}\n${bad}\n`, threadId })
    expect(parsed.events).toHaveLength(1)
    expect(parsed.unreadable[0]?.reason).toBe(EUnreadableReason.UnrecognizedBody)
  })
})

describe('meta read/write', () => {
  it('round-trips a thread meta atomically', async () => {
    const dir = await tempDir()
    const file = threadMetaFile({ sessionDir: dir, threadId })
    const meta = newThreadMeta({ id: threadId, at: '2026-09-23T00:00:00.000Z' })
    await writeMeta({ file, meta })
    const read = readMetaSync({ file, schema: threadMetaSchema })
    expect(read?.id).toBe(threadId)
    expect(read?.head).toBe(0)
  })

  it('returns undefined for a missing file', async () => {
    const dir = await tempDir()
    const read = readMetaSync({ file: sessionMetaFile({ sessionDir: dir }), schema: sessionMetaSchema })
    expect(read).toBeUndefined()
  })

  it('refuses a session written by a newer format', async () => {
    const dir = await tempDir()
    await writeMeta({
      file: sessionMetaFile({ sessionDir: dir }),
      meta: {
        format: 2,
        id: 'brn_x',
        title: null,
        createdAt: '2026-09-23T00:00:00.000Z',
        updatedAt: '2026-09-23T00:00:00.000Z',
        home: 'local',
        repo: null,
        workspace: null,
        worktree: null,
        pullRequests: null,
        spend: null,
      },
    })
    expect(() => readSessionMetaSync({ file: sessionMetaFile({ sessionDir: dir }), sessionDir: dir })).toThrow(
      SessionFromNewerAtlasError,
    )
  })
})

describe('session lock', () => {
  it('claims a free session', async () => {
    const dir = await tempDir()
    const outcome = await claimSession({ sessionDir: dir, lockFile: sessionLockFile({ sessionDir: dir }), label: 'spec' })
    expect(outcome.claim).toBe(ESessionClaim.Owned)
  })

  it('refuses a session held by a live pid', async () => {
    const dir = await tempDir()
    const lockFile = sessionLockFile({ sessionDir: dir })
    await writeMeta({ file: lockFile, meta: { pid: process.pid, label: 'other' } })
    const outcome = await claimSession({ sessionDir: dir, lockFile, label: 'spec' })
    expect(outcome.claim).toBe(ESessionClaim.Held)
    expect(outcome.heldBy).toBe(process.pid)
  })

  it('reclaims a lock whose holder is dead', async () => {
    const dir = await tempDir()
    const lockFile = sessionLockFile({ sessionDir: dir })
    const dead = Bun.spawnSync(['sleep', '0']).pid
    await writeMeta({ file: lockFile, meta: { pid: dead, label: 'crashed' } })
    const outcome = await claimSession({ sessionDir: dir, lockFile, label: 'spec' })
    expect(outcome.claim).toBe(ESessionClaim.Reclaimed)
  })

  it('releases only its own lock', async () => {
    const dir = await tempDir()
    const lockFile = sessionLockFile({ sessionDir: dir })
    await writeMeta({ file: lockFile, meta: { pid: process.pid + 99999, label: 'other' } })
    expect(await releaseSession({ lockFile })).toBe(false)
    await claimSession({ sessionDir: dir, lockFile, label: 'spec' })
    expect(await releaseSession({ lockFile })).toBe(true)
  })
})

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  ELogSeverity,
  LogPort,
  toEventId,
  toRunId,
  toThreadId,
  type EventDraft,
  type EventEnvelope,
  type LogEntry,
} from '@dltech/atlas-core'

import { EUnreadableReason } from '../../decode-events'
import { dropTornTail, encodeEventLine, parseEventLines } from '../lines'
import { claimSession, ESessionClaim } from '../lock'
import { readMetaSync, sessionMetaSchema, threadMetaSchema } from '../meta'
import { eventLogFile, sessionLockFile, sessionMetaFile, threadMetaFile } from '../paths'

class CapturingLog extends LogPort {
  readonly entries: LogEntry[] = []

  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-op-log-'))
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

describe('operational logging for degraded store reads', () => {
  describe('store.lines', () => {
    it('warns for a malformed non-tail line, carrying threadId, seq and reason', () => {
      const log = new CapturingLog()
      const first = encodeEventLine({ draft: draft(), envelope: envelope({ seq: 1 }) })
      const second = encodeEventLine({ draft: draft(), envelope: envelope({ seq: 2 }) })
      const parsed = parseEventLines({ text: `${first}\n{not json\n${second}\n`, threadId, logPort: log })
      expect(parsed.unreadable).toHaveLength(1)
      const entry = log.entries.find((one) => one.source === 'store.lines')
      expect(entry?.severity).toBe(ELogSeverity.Warn)
      expect(entry?.threadId).toBe(threadId)
      expect(entry?.data).toMatchObject({ seq: 0, reason: EUnreadableReason.MalformedJson })
    })

    it('does not warn for a torn final line, which dropTornTail already owns', () => {
      const log = new CapturingLog()
      const second = encodeEventLine({ draft: draft(), envelope: envelope({ seq: 2 }) })
      parseEventLines({ text: `${second.slice(0, second.length - 10)}`, threadId, logPort: log })
      expect(log.entries).toHaveLength(0)
    })
  })

  describe('store.meta', () => {
    it('warns with stage parse for a meta that is not valid JSON', async () => {
      const dir = await tempDir()
      const file = threadMetaFile({ sessionDir: dir, threadId })
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, '{broken')
      const log = new CapturingLog()
      expect(readMetaSync({ file, schema: threadMetaSchema, logPort: log })).toBeUndefined()
      const entry = log.entries.find((one) => one.source === 'store.meta')
      expect(entry?.severity).toBe(ELogSeverity.Warn)
      expect(entry?.threadId).toBeUndefined()
      expect(entry?.data).toMatchObject({ path: file, stage: 'parse' })
      expect(entry?.error).toBeDefined()
    })

    it('stays silent for a missing meta file', async () => {
      const dir = await tempDir()
      const log = new CapturingLog()
      const read = readMetaSync({ file: sessionMetaFile({ sessionDir: dir }), schema: sessionMetaSchema, logPort: log })
      expect(read).toBeUndefined()
      expect(log.entries).toHaveLength(0)
    })
  })

  describe('store.lock', () => {
    it('warns when the existing lock file cannot be read, then opens as a guest', async () => {
      const dir = await tempDir()
      const lockFile = sessionLockFile({ sessionDir: dir })
      mkdirSync(dirname(lockFile), { recursive: true })
      writeFileSync(lockFile, '{not a lock')
      const log = new CapturingLog()
      const outcome = await claimSession({ sessionDir: dir, lockFile, label: 'spec', logPort: log })
      expect(outcome.claim).toBe(ESessionClaim.Guest)
      const entry = log.entries.find((one) => one.source === 'store.lock')
      expect(entry?.severity).toBe(ELogSeverity.Warn)
      expect(entry?.data).toMatchObject({ path: lockFile, label: 'spec' })
    })

    it('stays silent when no lock file exists yet', async () => {
      const dir = await tempDir()
      const lockFile = sessionLockFile({ sessionDir: dir })
      mkdirSync(dirname(lockFile), { recursive: true })
      const log = new CapturingLog()
      const held = Bun.spawn(['sleep', '60'], { stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' })
      try {
        writeFileSync(lockFile, JSON.stringify({ pid: held.pid, label: 'other' }))
        const outcome = await claimSession({ sessionDir: dir, lockFile, label: 'spec', logPort: log })
        expect(outcome.claim).toBe(ESessionClaim.Held)
        expect(log.entries).toHaveLength(0)
      } finally {
        held.kill()
      }
    })
  })

  describe('dropTornTail', () => {
    it('warns when the append path truncates a torn final line', async () => {
      const dir = await tempDir()
      const file = eventLogFile({ sessionDir: dir, threadId })
      mkdirSync(dirname(file), { recursive: true })
      const good = encodeEventLine({ draft: draft(), envelope: envelope({ seq: 1 }) })
      writeFileSync(file, `${good}\n{"v":1,"id":"evt_2`)
      const log = new CapturingLog()
      expect(await dropTornTail({ file, threadId, on: 'append', logPort: log })).toBe(true)
      const entry = log.entries.find((one) => one.source === 'store.event-log')
      expect(entry?.severity).toBe(ELogSeverity.Warn)
      expect(entry?.threadId).toBe(threadId)
      expect(entry?.data).toMatchObject({ on: 'append' })
      expect(typeof entry?.data?.droppedBytes).toBe('number')
    })
  })
})

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toRunId, toThreadId, type EventDraft } from '@dltech/atlas-core'

import { JsonlTurnLedger } from '../../../ledger/jsonl'
import type { TurnSpend } from '../../../ledger/turn-ledger.port'
import { CountingIds, SteppingClock } from '../../__tests__/harness'
import { JsonlEventLog } from '../event-log'
import { listRoots } from '../listing'
import { readMetaSync, sessionMetaSchema, type SessionMeta } from '../meta'
import { sessionDirectory, sessionMetaFile } from '../paths'
import { SessionRegistry } from '../registry'
import { JsonlThreadStore } from '../thread-store'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-listing-'))
  directories.push(dir)
  return dir
}

function openStore({ home }: { home: string }): {
  registry: SessionRegistry
  log: JsonlEventLog
  threads: JsonlThreadStore
  ledger: JsonlTurnLedger
  ids: CountingIds
} {
  const registry = new SessionRegistry(home)
  const clock = new SteppingClock()
  const ids = new CountingIds('spec')
  const log = new JsonlEventLog(home, registry, clock, ids)
  return {
    registry,
    log,
    threads: new JsonlThreadStore(home, registry, clock, ids, log),
    ledger: new JsonlTurnLedger({ home, registry }),
    ids,
  }
}

const said = (text: string): EventDraft => ({ type: 'user-said', text })

const turn = ({ threadId, runId, inputTokens }: { threadId: string; runId: string; inputTokens: number }): TurnSpend => ({
  runId: toRunId(runId),
  threadId: toThreadId(threadId),
  status: 'settled',
  providerId: 'anthropic',
  modelId: 'claude-opus-5',
  steps: 1,
  inputTokens,
  outputTokens: inputTokens / 2,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  startedAt: '2026-09-01T00:00:00.000Z',
  endedAt: '2026-09-01T00:00:01.000Z',
  durationMs: 1000,
})

function sessionMeta({ home, threadId }: { home: string; threadId: string }): SessionMeta {
  const sessionDir = sessionDirectory({ home, sessionId: toThreadId(threadId) })
  const meta = readMetaSync({ file: sessionMetaFile({ sessionDir }), schema: sessionMetaSchema })
  if (meta === undefined) throw new Error(`no session meta at ${sessionDir}`)
  return meta
}

describe('session meta spend caching', () => {
  it('recomputes spend from the ledger on every refresh, so a turn recorded after the first list still accumulates', async () => {
    const home = await tempHome()
    const { registry, log, threads, ledger, ids } = openStore({ home })
    const thread = await threads.create({ title: 'costly', workspace: '/work' })
    await log.append({ threadId: thread.id, runId: ids.nextRunId(), drafts: [said('spend something')] })

    await listRoots({ home, registry, project: '/work' })
    expect(sessionMeta({ home, threadId: thread.id }).spend).toBeNull()

    await ledger.record(turn({ threadId: thread.id, runId: 'run-a', inputTokens: 100 }))
    await listRoots({ home, registry, project: '/work' })
    expect(sessionMeta({ home, threadId: thread.id }).spend).toMatchObject({ inputTokens: 100, outputTokens: 50 })

    await ledger.record(turn({ threadId: thread.id, runId: 'run-b', inputTokens: 40 }))
    await listRoots({ home, registry, project: '/work' })
    expect(sessionMeta({ home, threadId: thread.id }).spend).toMatchObject({ inputTokens: 140, outputTokens: 70 })
  })
})

describe('session meta writes under concurrency', () => {
  it('keeps both a refresh and a rename from losing the other writer’s fields', async () => {
    const home = await tempHome()
    const { registry, log, threads, ledger, ids } = openStore({ home })
    const thread = await threads.create({ title: 'before', workspace: '/work' })
    await log.append({ threadId: thread.id, runId: ids.nextRunId(), drafts: [said('hello')] })
    await ledger.record(turn({ threadId: thread.id, runId: 'run-a', inputTokens: 100 }))

    await Promise.all([
      threads.rename({ threadId: thread.id, title: 'after' }),
      listRoots({ home, registry, project: '/work' }),
    ])

    const meta = sessionMeta({ home, threadId: thread.id })
    expect(meta.title).toBe('after')
    expect(meta.spend).toMatchObject({ inputTokens: 100 })
  })
})

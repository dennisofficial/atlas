import { afterEach, describe, expect, it } from 'bun:test'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toRunId, toThreadId, type RunId, type ThreadId } from '@dltech/atlas-core'

import { newThreadMeta, writeMeta } from '../../../store/sessions/meta'
import { ledgerFile, sessionDirectory, threadMetaFile } from '../../../store/sessions/paths'
import { SessionRegistry } from '../../../store/sessions/registry'
import { SupervisionTreeTooDeep } from '../../spawned-threads'
import type { TurnSpend } from '../../turn-ledger.port'
import { JsonlTurnLedger, sumSessionSpend } from '../jsonl-turn-ledger'

type Fixture = {
  home: string
  sessionDir: string
  rootId: ThreadId
  registry: SessionRegistry
  ledger: JsonlTurnLedger
}

const fixtures: Fixture[] = []
const homes: string[] = []

const AT = '2026-09-23T10:00:00.000Z'

async function open(): Promise<Fixture> {
  const home = mkdtempSync(join(tmpdir(), 'atlas-jsonl-ledger-'))
  const rootId = toThreadId('thread-root')
  const sessionDir = sessionDirectory({ home, sessionId: rootId })
  const registry = new SessionRegistry(home)
  const fixture: Fixture = { home, sessionDir, rootId, registry, ledger: new JsonlTurnLedger({ home, registry }) }
  fixtures.push(fixture)
  await plantThread({ fixture, threadId: rootId })
  return fixture
}

async function plantThread({
  fixture,
  threadId,
  spawnerThreadId,
  createdAt = AT,
}: {
  fixture: Fixture
  threadId: ThreadId
  spawnerThreadId?: ThreadId
  createdAt?: string
}): Promise<void> {
  const meta = newThreadMeta({ id: threadId, at: createdAt })
  await writeMeta({
    file: threadMetaFile({ sessionDir: fixture.sessionDir, threadId }),
    meta: { ...meta, createdAt, spawnerThreadId: spawnerThreadId ?? null },
  })
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) homes.push(fixture.home)
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const spendOf = (args: {
  threadId: ThreadId
  runId: RunId
  status: string
  startedAt?: string
}): TurnSpend => ({
  runId: args.runId,
  threadId: args.threadId,
  status: args.status,
  providerId: 'anthropic',
  modelId: 'claude-opus-5',
  steps: 3,
  inputTokens: 42_000,
  outputTokens: 1_200,
  cacheReadTokens: 38_000,
  cacheWriteTokens: 2_500,
  startedAt: args.startedAt ?? AT,
  endedAt: '2026-09-23T10:00:12.000Z',
  durationMs: 12_000,
})

describe('JsonlTurnLedger', () => {
  it('reads back every field it was given', async () => {
    const { ledger, rootId } = await open()
    const spend = spendOf({ threadId: rootId, runId: toRunId('run-1'), status: 'completed' })

    await ledger.record(spend)

    expect(await ledger.forThread({ threadId: rootId })).toEqual([spend])
  })

  it('records the terminal status a turn actually reached', async () => {
    const { ledger, rootId } = await open()

    await ledger.record(spendOf({ threadId: rootId, runId: toRunId('run-1'), status: 'interrupted' }))
    await ledger.record(spendOf({ threadId: rootId, runId: toRunId('run-2'), status: 'failed' }))

    expect((await ledger.forThread({ threadId: rootId })).map((spend) => spend.status)).toEqual([
      'interrupted',
      'failed',
    ])
  })

  it('keeps one row per run, with the later append winning a replayed write', async () => {
    const { ledger, rootId, sessionDir } = await open()
    const spend = spendOf({ threadId: rootId, runId: toRunId('run-1'), status: 'completed' })

    await ledger.record(spend)
    await ledger.record({ ...spend, steps: 4, outputTokens: 1_500 })

    const rows = await ledger.forThread({ threadId: rootId })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.steps).toBe(4)
    expect(rows[0]?.outputTokens).toBe(1_500)

    const lines = readFileSync(ledgerFile({ sessionDir }), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
  })

  it('orders a thread’s turns by startedAt, not by append order', async () => {
    const { ledger, rootId } = await open()

    await ledger.record(
      spendOf({ threadId: rootId, runId: toRunId('run-late'), status: 'completed', startedAt: '2026-09-23T11:00:00.000Z' }),
    )
    await ledger.record(
      spendOf({ threadId: rootId, runId: toRunId('run-early'), status: 'completed', startedAt: '2026-09-23T09:00:00.000Z' }),
    )

    expect((await ledger.forThread({ threadId: rootId })).map((spend) => spend.runId)).toEqual([
      toRunId('run-early'),
      toRunId('run-late'),
    ])
  })

  it('leaves the threads of other turns out of the answer', async () => {
    const fixture = await open()
    const otherId = toThreadId('thread-other')
    await plantThread({ fixture, threadId: otherId })

    await fixture.ledger.record(
      spendOf({ threadId: fixture.rootId, runId: toRunId('run-1'), status: 'completed' }),
    )

    expect(await fixture.ledger.forThread({ threadId: otherId })).toEqual([])
  })

  it('creates the session directory when the first turn lands before anything else wrote there', async () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-jsonl-ledger-'))
    homes.push(home)
    const ledger = new JsonlTurnLedger({ home, registry: new SessionRegistry(home) })
    const threadId = toThreadId('thread-fresh')

    await ledger.record(spendOf({ threadId, runId: toRunId('run-1'), status: 'completed' }))

    expect(await ledger.forThread({ threadId })).toHaveLength(1)
  })

  it('answers an empty list when no ledger file exists yet', async () => {
    const { ledger, rootId, sessionDir } = await open()

    expect(await ledger.forThread({ threadId: rootId })).toEqual([])
    await expect(sumSessionSpend({ sessionDir })).resolves.toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('counts a truncated final line as absent, the way a crash would leave it', async () => {
    const { ledger, rootId, sessionDir } = await open()
    await ledger.record(spendOf({ threadId: rootId, runId: toRunId('run-1'), status: 'completed' }))
    appendFileSync(ledgerFile({ sessionDir }), '{"runId":"run-2","thre')

    expect((await ledger.forThread({ threadId: rootId })).map((spend) => spend.runId)).toEqual([
      toRunId('run-1'),
    ])
  })

  it('skips a garbled line in the middle without losing the rows around it', async () => {
    const { ledger, rootId, sessionDir } = await open()
    await ledger.record(spendOf({ threadId: rootId, runId: toRunId('run-1'), status: 'completed' }))
    appendFileSync(ledgerFile({ sessionDir }), 'not json at all\n')
    await ledger.record(spendOf({ threadId: rootId, runId: toRunId('run-2'), status: 'completed' }))

    expect((await ledger.forThread({ threadId: rootId })).map((spend) => spend.runId)).toEqual([
      toRunId('run-1'),
      toRunId('run-2'),
    ])
  })
})

describe('JsonlTurnLedger.forThreadTree', () => {
  it('splits the root’s own turns from what its spawned agents spent', async () => {
    const fixture = await open()
    const childId = toThreadId('thread-child')
    const grandchildId = toThreadId('thread-grandchild')
    const unrelatedId = toThreadId('thread-unrelated')
    await plantThread({ fixture, threadId: childId, spawnerThreadId: fixture.rootId, createdAt: '2026-09-23T10:01:00.000Z' })
    await plantThread({ fixture, threadId: grandchildId, spawnerThreadId: childId, createdAt: '2026-09-23T10:02:00.000Z' })
    await plantThread({ fixture, threadId: unrelatedId, createdAt: '2026-09-23T10:03:00.000Z' })

    await fixture.ledger.record(spendOf({ threadId: fixture.rootId, runId: toRunId('run-own'), status: 'completed' }))
    await fixture.ledger.record(spendOf({ threadId: childId, runId: toRunId('run-child'), status: 'completed' }))
    await fixture.ledger.record(spendOf({ threadId: grandchildId, runId: toRunId('run-grand'), status: 'completed' }))
    await fixture.ledger.record(spendOf({ threadId: unrelatedId, runId: toRunId('run-unrelated'), status: 'completed' }))

    const tree = await fixture.ledger.forThreadTree({ threadId: fixture.rootId })
    expect(tree.own.map((spend) => spend.runId)).toEqual([toRunId('run-own')])
    expect(tree.delegated.map((spend) => spend.runId)).toEqual([toRunId('run-child'), toRunId('run-grand')])
  })

  it('refuses to under-count a supervision chain deeper than the walk follows', async () => {
    const fixture = await open()
    let spawner = fixture.rootId
    for (const depth of ['one', 'two', 'three']) {
      const threadId = toThreadId(`thread-${depth}`)
      await plantThread({ fixture, threadId, spawnerThreadId: spawner, createdAt: AT })
      spawner = threadId
    }

    await expect(fixture.ledger.forThreadTree({ threadId: fixture.rootId })).rejects.toBeInstanceOf(
      SupervisionTreeTooDeep,
    )
  })
})

describe('sumSessionSpend', () => {
  it('totals the four token kinds across every thread of the session, last write per run', async () => {
    const fixture = await open()
    const childId = toThreadId('thread-child')
    await plantThread({ fixture, threadId: childId, spawnerThreadId: fixture.rootId })

    await fixture.ledger.record(spendOf({ threadId: fixture.rootId, runId: toRunId('run-1'), status: 'completed' }))
    await fixture.ledger.record(spendOf({ threadId: childId, runId: toRunId('run-2'), status: 'completed' }))
    const replayed = spendOf({ threadId: childId, runId: toRunId('run-2'), status: 'completed' })
    await fixture.ledger.record({ ...replayed, inputTokens: 50_000 })

    expect(await sumSessionSpend({ sessionDir: fixture.sessionDir })).toEqual({
      inputTokens: 42_000 + 50_000,
      outputTokens: 1_200 + 1_200,
      cacheReadTokens: 38_000 + 38_000,
      cacheWriteTokens: 2_500 + 2_500,
    })
  })
})

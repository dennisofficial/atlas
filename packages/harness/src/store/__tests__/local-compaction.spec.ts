import { afterEach, describe, expect, it } from 'bun:test'

import { ECompactionAnchor, toRunId, type EventDraft, type ThreadId } from '@dltech/atlas-core'

import { ECompaction, ECompactScope, type Summariser } from '../../composition/compact-turn'
import { CompactionPort } from '../compaction-port'
import { LocalCompaction } from '../local-compaction'
import { openStoreFixture, type StoreFixture } from './harness'

let fixture: StoreFixture | undefined

afterEach(async () => {
  await fixture?.close()
  fixture = undefined
})

const said = (text: string): EventDraft => ({ type: 'user-said', text })
const replied = (text: string): EventDraft => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})

const conversation = [said('one'), replied('two'), said('three'), replied('four'), said('five')]

const open = async (summarise: Summariser): Promise<{ port: CompactionPort; threadId: ThreadId }> => {
  fixture = openStoreFixture()
  const thread = await fixture.threads.create({ title: 'work' })
  await fixture.log.append({ threadId: thread.id, runId: toRunId('run-1'), drafts: conversation })
  const port = new LocalCompaction({
    log: fixture.log,
    threads: fixture.threads,
    agents: fixture.agents,
    summarise,
  })
  return { port, threadId: thread.id }
}

describe('LocalCompaction', () => {
  it('is a CompactionPort', async () => {
    const { port } = await open(async () => 'summary')

    expect(port).toBeInstanceOf(CompactionPort)
  })

  it('compacts a prefix with the default recent scope, keeping the rows', async () => {
    const seen: { fromSeq: number; throughSeq: number }[] = []
    const { port, threadId } = await open(async ({ fromSeq, throughSeq }) => {
      seen.push({ fromSeq, throughSeq })
      return 'summary'
    })

    const outcome = await port.compact({ threadId })

    expect(outcome.type).toBe(ECompaction.Compacted)
    expect(seen).toHaveLength(1)
    const rows = await fixture!.log.read({ threadId })
    expect(rows.filter((event) => event.type === 'user-said')).toHaveLength(3)
  })

  it('compacts everything when asked for the everything scope', async () => {
    const { port, threadId } = await open(async () => 'summary')
    const head = (await fixture!.log.read({ threadId })).at(-1)!.seq

    const outcome = await port.compact({ threadId, scope: ECompactScope.Everything })

    expect(outcome).toMatchObject({ type: ECompaction.Compacted, throughSeq: head })
  })

  it('reports nothing to compact on an empty thread', async () => {
    fixture = openStoreFixture()
    const thread = await fixture.threads.create({ title: 'empty' })
    const port = new LocalCompaction({
      log: fixture.log,
      threads: fixture.threads,
      agents: fixture.agents,
      summarise: async () => 'summary',
    })

    expect(await port.compact({ threadId: thread.id })).toEqual({ type: ECompaction.Nothing })
  })

  it('summarises destructively around the given anchor and seq', async () => {
    const { port, threadId } = await open(async () => 'summary')
    const before = await fixture!.log.read({ threadId })
    const through = before[1]!.seq

    const outcome = await port.summarise({ threadId, anchor: ECompactionAnchor.Prefix, seq: through })

    expect(outcome).toMatchObject({ type: ECompaction.Compacted, throughSeq: through })
    const after = await fixture!.log.read({ threadId })
    expect(after.some((event) => event.seq === before[0]!.seq && event.type === 'user-said')).toBe(false)
  })

  it('surfaces a refusal when the summariser yields nothing', async () => {
    const { port, threadId } = await open(async () => null)

    const outcome = await port.compact({ threadId, scope: ECompactScope.Everything })

    expect(outcome.type).toBe(ECompaction.Refused)
  })

  it('hands the abort signal to the summariser', async () => {
    let received: AbortSignal | undefined
    const { port, threadId } = await open(async ({ signal }) => {
      received = signal
      return 'summary'
    })
    const controller = new AbortController()

    await port.compact({ threadId, signal: controller.signal })

    expect(received).toBe(controller.signal)
  })
})

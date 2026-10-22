import { afterEach, describe, expect, it } from 'bun:test'

import { EClientFrame, EClientRequest, LocalCompaction, type Summariser } from '@dltech/atlas-harness'
import { EWireCompactionAnchor, EWireCompactScope } from '@dltech/atlas-wire'

import { createCompactionRequests } from '../compaction-requests'
import { createHistoryAdmission } from '../history-admission'
import type { RequestFrame } from '../request-reply'

import { jsonlRows, openSeededStore, probeSummariser, seqOf, threadId } from './cloud-compaction-fixture'
import type { StoreFixture } from '../../../../packages/harness/src/store/__tests__/harness'

let store: StoreFixture | undefined

afterEach(async () => {
  await store?.close()
  store = undefined
})

const request = (args: { id: string; op: EClientRequest; params: unknown }): RequestFrame => ({
  kind: EClientFrame.Request,
  ...args,
})

const open = async (summarise: Summariser) => {
  store = await openSeededStore()
  const admission = createHistoryAdmission({ threadId: () => threadId, intake: null, unavailable: () => false })
  const changed: number[] = []
  const requests = createCompactionRequests({
    threadId,
    driver: { holdHistory: admission.hold },
    changed: () => void changed.push(1),
    compaction: new LocalCompaction({
      log: store.log,
      threads: store.threads,
      agents: store.agents,
      summarise,
    }),
  })
  return { requests, changed, admission, store }
}

const compact = (args: { id: string; scope?: EWireCompactScope; operationId?: string }) =>
  request({
    id: args.id,
    op: EClientRequest.CompactHistory,
    params: {
      threadId,
      operationId: args.operationId ?? `op-${args.id}`,
      ...(args.scope === undefined ? {} : { scope: args.scope }),
    },
  })

const summarise = (args: { id: string; anchor: EWireCompactionAnchor; seq: number }) =>
  request({
    id: args.id,
    op: EClientRequest.SummariseHistory,
    params: { threadId, operationId: `op-${args.id}`, anchor: args.anchor, seq: args.seq },
  })

describe('compaction requests over the real JSONL store', () => {
  it('compacts with the default scope, keeping every row and the latest operator turn visible', async () => {
    const probe = probeSummariser()
    const { requests, changed } = await open(probe.summariser)
    const before = jsonlRows(store!)

    const reply = await requests.answer(compact({ id: 'a' }))

    const fiveSeq = seqOf({ events: await store!.log.read({ threadId }), match: 'five' })
    expect(reply).toMatchObject({ ok: true, data: { type: 'compacted', throughSeq: fiveSeq - 1 } })
    expect(probe.calls).toHaveLength(1)
    const after = jsonlRows(store!)
    expect(after.slice(0, before.length)).toEqual(before)
    expect(after.filter((row) => row.type === 'history-compacted')).toHaveLength(1)
    expect(changed).toHaveLength(1)
  })

  it('compacts everything through the head while still keeping every row', async () => {
    const { requests } = await open(probeSummariser().summariser)
    const head = jsonlRows(store!).at(-1)!.seq

    const reply = await requests.answer(compact({ id: 'a', scope: EWireCompactScope.Everything }))

    expect(reply).toMatchObject({ ok: true, data: { type: 'compacted', throughSeq: head } })
    const types = jsonlRows(store!).map((row) => row.type)
    expect(types.filter((type) => type === 'user-said')).toHaveLength(3)
  })

  it('summarises a prefix destructively, removes exactly the range and keeps context-loaded', async () => {
    const { requests } = await open(probeSummariser().summariser)
    const events = await store!.log.read({ threadId })
    const through = seqOf({ events, match: 'four' })
    const loaded = seqOf({ events, match: 'context-loaded' })

    const reply = await requests.answer(
      summarise({ id: 'a', anchor: EWireCompactionAnchor.Prefix, seq: through }),
    )

    expect(reply).toMatchObject({ ok: true, data: { type: 'compacted', fromSeq: events[0]!.seq, throughSeq: through } })
    const rows = jsonlRows(store!)
    expect(rows.filter((row) => row.seq < through && row.type !== 'context-loaded' && row.type !== 'history-compacted')).toEqual([])
    expect(rows.some((row) => row.seq === loaded && row.type === 'context-loaded')).toBe(true)
    expect(rows.filter((row) => row.seq > through).map((row) => row.type)).toEqual([
      'user-said',
      'assistant-said',
    ])
  })

  it('summarises a suffix destructively from the anchor to the head', async () => {
    const { requests } = await open(probeSummariser().summariser)
    const events = await store!.log.read({ threadId })
    const from = seqOf({ events, match: 'five' })
    const head = events.at(-1)!.seq

    const reply = await requests.answer(
      summarise({ id: 'a', anchor: EWireCompactionAnchor.Suffix, seq: from }),
    )

    expect(reply).toMatchObject({ ok: true, data: { type: 'compacted', fromSeq: from, throughSeq: head } })
    const rows = jsonlRows(store!)
    expect(rows.filter((row) => row.seq >= from).map((row) => row.type)).toEqual(['history-compacted'])
    expect(rows.filter((row) => row.seq < from)).toHaveLength(events.length - 2)
  })

  it('refuses a summary that would split a tool exchange and leaves the log untouched', async () => {
    const probe = probeSummariser()
    const { requests, changed } = await open(probe.summariser)
    const events = await store!.log.read({ threadId })
    const before = jsonlRows(store!)

    const reply = await requests.answer(
      summarise({ id: 'a', anchor: EWireCompactionAnchor.Prefix, seq: seqOf({ events, match: 'tool-called' }) }),
    )

    expect(reply).toMatchObject({ ok: true, data: { type: 'refused' } })
    expect(probe.calls).toEqual([])
    expect(jsonlRows(store!)).toEqual(before)
    expect(changed).toEqual([])
  })

  it('refuses foreign threads and malformed params before touching the summariser', async () => {
    const probe = probeSummariser()
    const { requests } = await open(probe.summariser)
    const before = jsonlRows(store!)

    const foreign = await requests.answer(
      request({
        id: 'f',
        op: EClientRequest.CompactHistory,
        params: { threadId: 'thread-elsewhere', operationId: 'op', scope: EWireCompactScope.Recent },
      }),
    )
    const malformed = await requests.answer(
      request({ id: 'm', op: EClientRequest.SummariseHistory, params: { threadId, operationId: 'op', anchor: 'middle', seq: -1 } }),
    )
    const foreignCancel = await requests.answer(
      request({ id: 'c', op: EClientRequest.CancelCompaction, params: { threadId: 'thread-elsewhere', operationId: 'op' } }),
    )

    for (const reply of [foreign, malformed, foreignCancel]) expect(reply).toMatchObject({ ok: false })
    expect(probe.calls).toEqual([])
    expect(jsonlRows(store!)).toEqual(before)
  })

  it('refuses a second compaction while one is in flight and reports itself active', async () => {
    const probe = probeSummariser({ held: true })
    const { requests, admission } = await open(probe.summariser)
    expect(requests.active()).toBe(false)

    const first = requests.answer(compact({ id: 'a' }))
    await probe.entered
    const second = await requests.answer(compact({ id: 'b' }))

    expect(requests.active()).toBe(true)
    expect(admission.held()).toBe(true)
    expect(second).toMatchObject({ ok: false })
    expect(probe.calls).toHaveLength(1)
    probe.release()
    expect(await first).toMatchObject({ ok: true, data: { type: 'compacted' } })
    expect(requests.active()).toBe(false)
    expect(admission.held()).toBe(false)
  })

  it('aborts the owning summariser signal on cancel and leaves the log untouched', async () => {
    const probe = probeSummariser({ held: true, honoursAbort: true })
    const { requests, changed } = await open(probe.summariser)
    const before = jsonlRows(store!)

    const running = requests.answer(compact({ id: 'a', operationId: 'op-running' }))
    await probe.entered
    const cancel = await requests.answer(
      request({ id: 'c', op: EClientRequest.CancelCompaction, params: { threadId, operationId: 'op-running' } }),
    )

    expect(cancel).toMatchObject({ ok: true, data: { cancelled: true } })
    expect(probe.calls[0]!.signal?.aborted).toBe(true)
    expect(await running).toMatchObject({ ok: false })
    expect(jsonlRows(store!)).toEqual(before)
    expect(changed).toEqual([])
    expect(requests.active()).toBe(false)
  })

  it('does not write a summary a cancelled summariser ignores the abort to return', async () => {
    const probe = probeSummariser({ held: true })
    const { requests, changed } = await open(probe.summariser)
    const before = jsonlRows(store!)

    const running = requests.answer(compact({ id: 'a', operationId: 'op-late' }))
    await probe.entered
    await requests.answer(
      request({ id: 'c', op: EClientRequest.CancelCompaction, params: { threadId, operationId: 'op-late' } }),
    )
    probe.release()

    expect(await running).toMatchObject({ ok: false })
    expect(jsonlRows(store!)).toEqual(before)
    expect(changed).toEqual([])
  })

  it('answers a cancel for an unknown operation without aborting the active one', async () => {
    const probe = probeSummariser({ held: true })
    const { requests } = await open(probe.summariser)

    const running = requests.answer(compact({ id: 'a', operationId: 'op-real' }))
    await probe.entered
    const stray = await requests.answer(
      request({ id: 'c', op: EClientRequest.CancelCompaction, params: { threadId, operationId: 'op-other' } }),
    )

    expect(stray).toMatchObject({ ok: true, data: { cancelled: false } })
    expect(probe.calls[0]!.signal?.aborted).toBe(false)
    probe.release()
    expect(await running).toMatchObject({ ok: true })
  })
})

import { afterEach, describe, expect, it } from 'bun:test'

import { ECompactionAnchor } from '@dltech/atlas-core'
import { ECompaction, ECompactScope, EClientRequest, RemoteRequestFailed } from '@dltech/atlas-harness'

import {
  jsonlRows,
  probeSummariser,
  releaseCompactionServe,
  seqOf,
  startCompactionServe,
  threadId,
} from './cloud-compaction-fixture'
import { until } from './serve-remote-fixture'

afterEach(releaseCompactionServe)

describe('history compaction over a real websocket and JSONL log', () => {
  it('compacts by default, keeps every row, reloads clients and reads back through RemoteEventLog', async () => {
    const probe = probeSummariser()
    const served = await startCompactionServe({ summariser: probe.summariser })
    const watcher = await served.secondClient()
    const before = jsonlRows(served.store)

    const outcome = await served.compaction.compact({ threadId })

    const fiveSeq = seqOf({ events: await served.remoteLog.read({ threadId }), match: 'five' })
    expect(outcome).toMatchObject({ type: ECompaction.Compacted, throughSeq: fiveSeq - 1 })
    expect(probe.calls).toHaveLength(1)
    const after = jsonlRows(served.store)
    expect(after.slice(0, before.length)).toEqual(before)
    expect(after.at(-1)?.type).toBe('history-compacted')
    await until({ what: 'both clients to reload', condition: () => served.client.reloads.length > 0 && watcher.reloads.length > 0 })
    const remote = await served.remoteLog.read({ threadId })
    expect(remote.map((event) => event.seq)).toEqual(after.map((row) => row.seq))
    expect(remote.some((event) => event.type === 'history-compacted')).toBe(true)
  })

  it('compacts everything when asked, through the head', async () => {
    const served = await startCompactionServe({ summariser: probeSummariser().summariser })
    const head = jsonlRows(served.store).at(-1)!.seq

    const outcome = await served.compaction.compact({ threadId, scope: ECompactScope.Everything })

    expect(outcome).toMatchObject({ type: ECompaction.Compacted, throughSeq: head })
    expect(jsonlRows(served.store).filter((row) => row.type === 'user-said')).toHaveLength(3)
  })

  it('summarises a prefix destructively on the served disk and keeps context-loaded', async () => {
    const served = await startCompactionServe({ summariser: probeSummariser().summariser })
    const events = await served.remoteLog.read({ threadId })
    const through = seqOf({ events, match: 'four' })
    const loaded = seqOf({ events, match: 'context-loaded' })

    const outcome = await served.compaction.summarise({ threadId, anchor: ECompactionAnchor.Prefix, seq: through })

    expect(outcome).toMatchObject({ type: ECompaction.Compacted, fromSeq: events[0]!.seq, throughSeq: through })
    const rows = jsonlRows(served.store)
    expect(rows.filter((row) => row.seq <= through).map((row) => row.type).sort()).toEqual(['context-loaded', 'history-compacted'].sort())
    expect(rows.some((row) => row.seq === loaded)).toBe(true)
    expect(rows.filter((row) => row.seq > through).map((row) => row.type)).toEqual(['user-said', 'assistant-said'])
  })

  it('summarises a suffix destructively from the anchor to the head', async () => {
    const served = await startCompactionServe({ summariser: probeSummariser().summariser })
    const events = await served.remoteLog.read({ threadId })
    const from = seqOf({ events, match: 'five' })

    const outcome = await served.compaction.summarise({ threadId, anchor: ECompactionAnchor.Suffix, seq: from })

    expect(outcome).toMatchObject({ type: ECompaction.Compacted, fromSeq: from, throughSeq: events.at(-1)!.seq })
    expect(jsonlRows(served.store).filter((row) => row.seq >= from).map((row) => row.type)).toEqual(['history-compacted'])
  })

  it('reports a guard refusal for a split tool exchange and leaves the JSONL alone', async () => {
    const probe = probeSummariser()
    const served = await startCompactionServe({ summariser: probe.summariser })
    const events = await served.remoteLog.read({ threadId })
    const before = jsonlRows(served.store)

    const outcome = await served.compaction.summarise({
      threadId,
      anchor: ECompactionAnchor.Prefix,
      seq: seqOf({ events, match: 'tool-called' }),
    })

    expect(outcome.type).toBe(ECompaction.Refused)
    expect(probe.calls).toEqual([])
    expect(jsonlRows(served.store)).toEqual(before)
    expect(served.client.reloads).toEqual([])
  })

  it('cancels over the wire, aborting the owning summariser signal and preserving the log', async () => {
    const probe = probeSummariser({ held: true, honoursAbort: true })
    const served = await startCompactionServe({ summariser: probe.summariser })
    const before = jsonlRows(served.store)
    const controller = new AbortController()

    const running = served.compaction.compact({ threadId, signal: controller.signal })
    const settled = running.then(() => 'resolved', () => 'rejected')
    await probe.entered
    controller.abort()

    await until({ what: 'the serve to abort the summariser', condition: () => probe.calls[0]?.signal?.aborted === true })
    expect(await settled).toBe('rejected')
    expect(jsonlRows(served.store)).toEqual(before)
    expect(served.client.reloads).toEqual([])
  })

  it('writes nothing when a cancelled summariser ignores the abort and returns late', async () => {
    const probe = probeSummariser({ held: true })
    const served = await startCompactionServe({ summariser: probe.summariser })
    const before = jsonlRows(served.store)
    const controller = new AbortController()

    const running = served.compaction.compact({ threadId, signal: controller.signal })
    const settled = running.then(() => 'resolved', () => 'rejected')
    await probe.entered
    controller.abort()
    await until({ what: 'the serve to abort the summariser', condition: () => probe.calls[0]?.signal?.aborted === true })
    probe.release()

    await until({ what: 'the late summary to settle', condition: () => !served.client.workingNow() })
    await Bun.sleep(50)
    expect(jsonlRows(served.store)).toEqual(before)
    expect(served.client.reloads).toEqual([])
    expect(await served.compaction.compact({ threadId })).toMatchObject({ type: ECompaction.Compacted })
    void settled
  })

  it('refuses a compaction while a turn is running', async () => {
    const probe = probeSummariser()
    const served = await startCompactionServe({ summariser: probe.summariser, holdTurn: true })
    served.client.channel.send({ text: 'work' })
    await served.turn.entered

    const refused = served.compaction.compact({ threadId })

    await expect(refused).rejects.toBeInstanceOf(RemoteRequestFailed)
    expect(probe.calls).toEqual([])
    served.turn.release()
  })

  it('refuses a duplicate compaction while one is in flight', async () => {
    const probe = probeSummariser({ held: true })
    const served = await startCompactionServe({ summariser: probe.summariser })
    const second = await served.secondClient()

    const first = served.compaction.compact({ threadId })
    await probe.entered
    const duplicate = second.channel.request({
      op: EClientRequest.CompactHistory,
      params: { threadId, operationId: 'duplicate' },
    })

    await expect(duplicate).rejects.toBeInstanceOf(RemoteRequestFailed)
    expect(probe.calls).toHaveLength(1)
    probe.release()
    expect(await first).toMatchObject({ type: ECompaction.Compacted })
  })

  it('queues sends and refuses runs, rewind and agent steering while compacting', async () => {
    const probe = probeSummariser({ held: true })
    const served = await startCompactionServe({ summariser: probe.summariser })
    const second = await served.secondClient()
    const errors: string[] = []
    served.client.channel.onServerError(({ message }) => void errors.push(message))
    const before = jsonlRows(served.store)

    const running = served.compaction.compact({ threadId })
    await probe.entered
    served.client.channel.send({ text: 'sneaky' })
    served.client.channel.run()
    await until({ what: 'the run refusal and send acknowledgement', condition: () => errors.length >= 1 && served.client.frames.some((frame) => frame.kind === 'send-acked') })
    const rewind = second.channel.request({
      op: EClientRequest.Rewind,
      params: { threadId, cuts: [], toSeq: 1 },
    })
    const steer = second.channel.request({
      op: EClientRequest.StopAgent,
      params: { threadId, agentId: 'agent-1' },
    })

    const settled = await Promise.allSettled([rewind, steer])
    for (const result of settled) {
      expect(result.status).toBe('rejected')
      if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(RemoteRequestFailed)
    }
    expect(errors.every((message) => message.includes('summarised'))).toBe(true)
    expect(served.truncations).toEqual([])
    expect(served.agentCalls).toEqual([])
    expect(jsonlRows(served.store)).toEqual(before)
    probe.release()
    expect(await running).toMatchObject({ type: ECompaction.Compacted })
    await until({ what: 'the queued message to commit after compaction', condition: () => jsonlRows(served.store).some((row) => row.type === 'user-said' && row.seq > before.at(-1)!.seq) })
    expect(jsonlRows(served.store).filter((row) => row.type === 'user-said')).toHaveLength(4)
  })

  it('refuses a workspace handoff pause with an error frame while compacting', async () => {
    const probe = probeSummariser({ held: true })
    const served = await startCompactionServe({ summariser: probe.summariser })
    const errors: string[] = []
    served.client.channel.onServerError(({ message }) => void errors.push(message))

    const running = served.compaction.compact({ threadId })
    await probe.entered
    served.client.channel.pause()

    await until({ what: 'the pause refusal', condition: () => errors.length >= 1 })
    expect(errors[0]).toContain('summarised')
    probe.release()
    expect(await running).toMatchObject({ type: ECompaction.Compacted })
  })
})

import { describe, expect, it } from 'bun:test'

import {
  canonicalJson,
  GENESIS_HASH,
  isBlobRef,
  toCallId,
  verifySuffix,
  toRunId,
  type V2Event,
} from '@dltech/atlas-core'

import { flushUntil, makeRig, postAndRun, seedSession, SESSION, THREAD_ID } from './holder-rig'
import { SessionRecord } from '../record/record-adapter'
import { V2OnceLedger } from '../record/v2-once-ledger'

const readStored = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<V2Event[]> => {
  const page = await rig.plane.readEvents({
    threadId: THREAD_ID,
    afterSeq: 0,
    limit: 1000,
    visible: false,
  })
  return page.events
}

describe('SessionRecord blob spill', () => {
  it('spills a 10 MB tool output to a blob and resolves it for the model', async () => {
    const rig = await makeRig({ holderId: 'holder-a' })
    await seedSession(rig)
    await rig.holder.start()
    await postAndRun(rig, 'hello')
    const claimed = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(claimed).toBe(true)

    const runtime = rig.runtimes[0]
    if (runtime === undefined) throw new Error('no runtime')
    const lease = await rig.plane.currentLease({ sessionId: SESSION })
    const args = {
      plane: rig.plane,
      threadId: THREAD_ID,
      epoch: lease.lease.epoch,
      timers: rig.clock,
      remoteCalls: runtime.remoteCalls,
      daemonTools: runtime.daemonTools,
      nowIso: () => new Date(rig.clock.now()).toISOString(),
    }
    const record = await SessionRecord.open(args)

    const output = { text: 'x'.repeat(10 * 1024 * 1024) }
    await record.append({
      threadId: THREAD_ID,
      runId: toRunId('run-blob'),
      drafts: [{ type: 'tool-result', callId: toCallId('call-big'), name: 'bash', output }],
    })

    const stored = await readStored(rig)
    const storedResult = stored.find((event) => event.type === 'tool-result')
    if (storedResult?.type !== 'tool-result') throw new Error('no stored tool-result')
    expect(isBlobRef(storedResult.output)).toBe(true)
    expect(JSON.stringify(storedResult).length).toBeLessThan(4096)
    expect(verifySuffix({ trusted: { seq: 0, hash: GENESIS_HASH }, events: stored }).ok).toBe(true)

    const { events } = await record.read({ threadId: THREAD_ID })
    const resolved = events.find((event) => event.type === 'tool-result')
    if (resolved?.type !== 'tool-result') throw new Error('no resolved tool-result')
    expect(canonicalJson(resolved.output)).toBe(canonicalJson(output))

    const fresh = await SessionRecord.open(args)
    const freshEvents = (await fresh.read({ threadId: THREAD_ID })).events
    const freshResult = freshEvents.find((event) => event.type === 'tool-result')
    if (freshResult?.type !== 'tool-result') throw new Error('no fresh tool-result')
    expect(canonicalJson(freshResult.output)).toBe(canonicalJson(output))
  }, 30_000)

  it('replays a spilled fact-recorded value on the same and a fresh record', async () => {
    const rig = await makeRig({ holderId: 'holder-facts' })
    await seedSession(rig)
    await rig.holder.start()
    await postAndRun(rig, 'hello')
    const claimed = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(claimed).toBe(true)

    const runtime = rig.runtimes[0]
    if (runtime === undefined) throw new Error('no runtime')
    const lease = await rig.plane.currentLease({ sessionId: SESSION })
    const args = {
      plane: rig.plane,
      threadId: THREAD_ID,
      epoch: lease.lease.epoch,
      timers: rig.clock,
      remoteCalls: runtime.remoteCalls,
      daemonTools: runtime.daemonTools,
      blobSpillBytes: 1024,
      nowIso: () => new Date(rig.clock.now()).toISOString(),
    }
    const record = await SessionRecord.open(args)

    const value = { payload: 'fact-'.repeat(2_000) }
    await record.append({
      threadId: THREAD_ID,
      runId: toRunId('run-fact'),
      drafts: [{ type: 'fact-recorded', key: 'notes:big', kind: 'notes', value }],
    })

    const stored = await readStored(rig)
    const storedFact = stored.find((event) => event.type === 'fact-recorded')
    if (storedFact?.type !== 'fact-recorded') throw new Error('no stored fact')
    expect(isBlobRef(storedFact.value)).toBe(true)

    const replay = async (candidate: SessionRecord) => {
      const ledger = new V2OnceLedger({
        cache: candidate.eventCache(),
        record: candidate,
        threadId: THREAD_ID,
        runId: () => toRunId('run-replay'),
      })
      return ledger.once({
        key: 'notes:big',
        decide: () => Promise.reject(new Error('decide must not run for a recorded fact')),
      })
    }
    expect(canonicalJson(await replay(record))).toBe(canonicalJson(value))

    const fresh = await SessionRecord.open(args)
    expect(canonicalJson(await replay(fresh))).toBe(canonicalJson(value))
  }, 30_000)
})

import { describe, expect, it } from 'bun:test'

import {
  EDaemonAnswer,
  EToolEffect,
  saidBody,
  toCallId,
  toThreadId,
  type EventDraft,
} from '@dltech/atlas-core'

import { InMemoryAgentRecord, SequentialIds } from '../../testing'
import { settleCrashedCalls, type PodHoldProbe } from '../dispatch-recovery'

const THREAD = toThreadId('thread-hold')

const drafts: EventDraft[] = [
  saidBody({ text: 'start the service' }),
  { type: 'tool-called', callId: toCallId('call-1'), name: 'service', input: {}, ordinal: 0 },
  { type: 'tool-dispatched', callId: toCallId('call-1'), name: 'service', bootId: 'boot-a' },
]

const seeded = async () => {
  const ids = new SequentialIds()
  const record = new InMemoryAgentRecord(ids)
  await record.append({ threadId: THREAD, runId: ids.nextRunId(), drafts })
  return { ids, record }
}

const probeOf = (args: {
  answer: Awaited<ReturnType<PodHoldProbe['podAnswer']>>
  dispatchedBootId: string | undefined
  daemonBootId: string
}): PodHoldProbe => ({
  dispatchedBootId: () => args.dispatchedBootId,
  podAnswer: async () => args.answer,
  daemonBootId: () => args.daemonBootId,
})

const resultsOf = async (record: InMemoryAgentRecord) =>
  record.eventsOf(THREAD).filter((event) => event.type === 'tool-result')

const settle = async (args: {
  record: InMemoryAgentRecord
  ids: SequentialIds
  probe?: PodHoldProbe | undefined
}) =>
  settleCrashedCalls({
    record: args.record,
    ids: args.ids,
    threadId: THREAD,
    effectOf: (name) => (name === 'service' ? EToolEffect.Write : EToolEffect.Read),
    ...(args.probe === undefined ? {} : { probe: args.probe }),
  })

describe('settleCrashedCalls when the pod cannot answer', () => {
  it('leaves the call pending instead of inventing a restart', async () => {
    const { ids, record } = await seeded()

    await settle({
      record,
      ids,
      probe: probeOf({ answer: 'unavailable', dispatchedBootId: 'boot-a', daemonBootId: 'boot-a' }),
    })

    expect(await resultsOf(record)).toEqual([])
  })

  it('leaves a call the pod still holds', async () => {
    const { ids, record } = await seeded()

    await settle({
      record,
      ids,
      probe: probeOf({
        answer: EDaemonAnswer.Running,
        dispatchedBootId: 'boot-a',
        daemonBootId: 'boot-a',
      }),
    })

    expect(await resultsOf(record)).toEqual([])
  })

  it('leaves a call the same boot never saw, because that is its first run', async () => {
    const { ids, record } = await seeded()

    await settle({
      record,
      ids,
      probe: probeOf({
        answer: EDaemonAnswer.NeverSeen,
        dispatchedBootId: 'boot-a',
        daemonBootId: 'boot-a',
      }),
    })

    expect(await resultsOf(record)).toEqual([])
  })

  it('leaves a call whose dispatch recorded no pod boot, because no restart is proven', async () => {
    const { ids, record } = await seeded()

    await settle({
      record,
      ids,
      probe: probeOf({
        answer: EDaemonAnswer.NeverSeen,
        dispatchedBootId: undefined,
        daemonBootId: 'boot-b',
      }),
    })

    expect(await resultsOf(record)).toEqual([])
  })
})

describe('settleCrashedCalls when the pod proves a restart', () => {
  it('reports a call a new boot never saw as interrupted', async () => {
    const { ids, record } = await seeded()

    await settle({
      record,
      ids,
      probe: probeOf({
        answer: EDaemonAnswer.NeverSeen,
        dispatchedBootId: 'boot-a',
        daemonBootId: 'boot-b',
      }),
    })

    const results = await resultsOf(record)
    expect(results).toHaveLength(1)
    const result = results[0]
    if (result?.type !== 'tool-result') return
    expect(result.interrupted).toBe(true)
    expect(result.error?.message).toContain('process restart')
  })

  it('reports a call as interrupted when there is no pod to ask', async () => {
    const { ids, record } = await seeded()

    await settle({ record, ids })

    expect(await resultsOf(record)).toHaveLength(1)
  })
})

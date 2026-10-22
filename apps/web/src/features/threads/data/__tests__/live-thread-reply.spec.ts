import { describe, expect, it } from 'bun:test'

import { EServeFrame, type ClientFrame } from '@dltech/atlas-client/channel'
import { readEventsParamsSchema, type WireEvent } from '@dltech/atlas-wire/web'

import { ETranscriptKind, transcriptOf } from '../transcript'
import { flush, rig } from './live-thread-fixture'

const THREAD = 'thr_1'

const said = (args: { seq: number; type: string; body: object }): WireEvent => ({
  id: `evt_${args.seq}`,
  threadId: THREAD,
  seq: args.seq,
  runId: 'run_1',
  depth: 0,
  at: '2026-10-22T22:49:00.000Z',
  type: args.type,
  body: JSON.stringify({ type: args.type, ...args.body }),
})

const userHi = said({ seq: 1, type: 'user-said', body: { text: 'Hi' } })
const instructions = [2, 3].map((seq) =>
  said({ seq, type: 'context-loaded', body: { slot: 'user-instructions', key: `k${seq}` } }),
)
const reply = said({
  seq: 4,
  type: 'assistant-said',
  body: { parts: [{ type: 'text', text: 'Hi Dennis. What are we working on?' }] },
})

const servedAfter = (args: { log: readonly WireEvent[]; frame: ClientFrame }): WireEvent[] => {
  if (args.frame.kind !== 'request') return []
  const { fromSeq } = readEventsParamsSchema.parse(args.frame.params)
  return args.log.filter((event) => fromSeq === undefined || event.seq > fromSeq)
}

describe('the live thread view on a freshly provisioned pod', () => {
  it("shows the pod's reply when the context rows and the answer arrive in separate appends", async () => {
    const log: WireEvent[] = [userHi]
    const test = rig({ seed: [userHi] })
    test.controller.start()
    await flush()
    test.ready()
    await flush()

    const appendThenAnswer = async (appended: readonly WireEvent[]) => {
      log.push(...appended)
      const before = test.requests().length
      test.receive({
        kind: EServeFrame.Signal,
        seq: before + 1,
        signal: { type: 'events-appended' },
      })
      await flush()
      const request = test.requests()[before]
      if (request === undefined) throw new Error('no read-events request went out')
      test.answer({ index: before, events: servedAfter({ log, frame: request }) })
      await flush()
    }

    await appendThenAnswer(instructions)
    await appendThenAnswer([reply])

    expect(test.state().events.map((event) => event.seq)).toEqual([1, 2, 3, 4])
    expect(transcriptOf(test.state().events).map((item) => [item.kind, item.text])).toEqual([
      [ETranscriptKind.User, 'Hi'],
      [ETranscriptKind.Agent, 'Hi Dennis. What are we working on?'],
    ])
  })
})

import { describe, expect, it } from 'bun:test'

import { ESetupPhase, inboxEventPayloadOf } from '@dltech/atlas-core'
import { ESpan, type SpanFields } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'

import { flushUntil, makeRig, seedSession, SESSION, type HolderRig } from './holder-rig'

const countOf = async (rig: HolderRig, type: string): Promise<number> =>
  (await rig.events()).filter((event) => event.type === type).length

const typeIs =
  (type: string) =>
  (event: unknown): boolean =>
    typeof event === 'object' && event !== null && (event as { type?: unknown }).type === type

const postedDuring = (args: {
  rig: HolderRig
  text: string
  on: (event: unknown) => boolean
}): void => {
  const original = args.rig.plane.append.bind(args.rig.plane)
  let fired = false
  args.rig.plane.append = (async (params: Parameters<typeof original>[0]) => {
    if (!fired && params.events.some(args.on)) {
      fired = true
      await args.rig.post(args.text)
    }
    return original(params)
  }) as typeof args.rig.plane.append
}

const expectArmedOnThePrompt = (turn: { fields: SpanFields } | undefined): void => {
  const queuedMs = turn?.fields.queuedMs
  const firstTokenMs = turn?.fields.firstTokenMs
  expect(typeof queuedMs).toBe('number')
  expect(typeof firstTokenMs).toBe('number')
  if (typeof queuedMs !== 'number' || typeof firstTokenMs !== 'number') return
  expect(firstTokenMs).toBeGreaterThanOrEqual(queuedMs)
}

describe('the queued time of a turn that answers an unlogged message', () => {
  it('times the second turn of a warm session from the second prompt', async () => {
    const trace = new RecordingTracer()
    const rig = await makeRig({
      trace,
      script: [
        { text: 'one', streamMs: 5 },
        { text: 'two', streamMs: 5 },
      ],
    })
    await seedSession(rig)
    postedDuring({ rig, text: 'again', on: typeIs('turn-ended') })
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()
    expect(
      await flushUntil({
        check: async () => (await countOf(rig, 'assistant-said')) === 2,
        clock: rig.clock,
        advanceMs: 2_000,
        attempts: 200,
      }),
    ).toBe(true)

    const turns = trace.named(ESpan.Turn)
    expect(turns.length).toBeGreaterThanOrEqual(2)
    expectArmedOnThePrompt(turns[1])
  }, 15_000)

  it('times a turn that starts on a take-over of a thread that already has turns', async () => {
    const trace = new RecordingTracer()
    const rig = await makeRig({
      trace,
      script: [
        { text: 'one', streamMs: 5 },
        { text: 'two', streamMs: 5 },
      ],
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('hello')
    await rig.wake()
    expect(
      await flushUntil({
        check: async () => (await countOf(rig, 'assistant-said')) === 1,
        clock: rig.clock,
        advanceMs: 2_000,
        attempts: 200,
      }),
    ).toBe(true)
    expect(
      await flushUntil({
        check: () => rig.holder.heldIds().length === 0,
        clock: rig.clock,
        advanceMs: 2_000,
        attempts: 200,
      }),
    ).toBe(true)

    await rig.post('again')
    await rig.wake()
    expect(
      await flushUntil({
        check: async () => (await countOf(rig, 'assistant-said')) === 2,
        clock: rig.clock,
        advanceMs: 2_000,
        attempts: 200,
      }),
    ).toBe(true)

    const turns = trace.named(ESpan.Turn)
    expect(turns.length).toBeGreaterThanOrEqual(2)
    expectArmedOnThePrompt(turns[1])
  }, 15_000)

  it('leaves a notice-only wake without a queued time or a first token clock', async () => {
    const trace = new RecordingTracer()
    const rig = await makeRig({ trace, script: [{ text: 'noted it', streamMs: 5 }] })
    await seedSession(rig)
    await rig.plane.post({
      sessionId: SESSION,
      kind: 'event',
      payload: inboxEventPayloadOf({
        event: {
          type: 'sandbox-setup-reported',
          text: 'setup finished after 1.2s',
          failed: false,
          phase: ESetupPhase.Finished,
        },
        clientId: 'setup:1',
      }),
    })
    await rig.holder.start()
    await rig.wake()
    expect(
      await flushUntil({
        check: async () => (await countOf(rig, 'assistant-said')) === 1,
        attempts: 400,
      }),
    ).toBe(true)

    const [turn] = trace.named(ESpan.Turn)
    expect(turn?.fields.queuedMs).toBeUndefined()
    expect(turn?.fields.firstTokenMs).toBeUndefined()
    rig.holder.discard()
  }, 15_000)
})

import {
  EInputConsumed,
  EResumePoint,
  ETurnCause,
  ETurnEndedBy,
  ETurnOutcome,
} from '@dltech/atlas-core'
import type { V2Event } from '@dltech/atlas-core'
import { INBOX_KIND_STOP } from '@dltech/atlas-host'
import { expect } from 'bun:test'

import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import { EHostFault } from '../../testing/host-faults'
import type { HostProcess, ReadEvent } from '../../testing/fault-rig'

const CUT_TEXT = 'half a sentence the operator cut, and it must never reach the model again. '
const RESUMED_TEXT = 'the resumed reply'

const rowsOf = async (ctx: HandoffContext): Promise<V2Event[]> =>
  (await ctx.record()).map((row) => row.event as V2Event)

const markersOf = async (ctx: HandoffContext): Promise<V2Event[]> =>
  (await rowsOf(ctx)).filter((event) => event.type === 'resume-marked')

const consumedOf = async (ctx: HandoffContext): Promise<V2Event[]> =>
  (await rowsOf(ctx)).filter(
    (event) => event.type === 'input-consumed' && event.consumed === EInputConsumed.Command,
  )

const resumedStartsOf = async (ctx: HandoffContext): Promise<V2Event[]> =>
  (await rowsOf(ctx)).filter(
    (event) => event.type === 'turn-started' && event.cause === ETurnCause.Resume,
  )

const endsOf = async (ctx: HandoffContext): Promise<V2Event[]> =>
  (await rowsOf(ctx)).filter((event) => event.type === 'turn-ended')

const stoppedEndsOf = async (ctx: HandoffContext): Promise<V2Event[]> =>
  (await endsOf(ctx)).filter(
    (event) => event.type === 'turn-ended' && event.outcome === ETurnOutcome.Stopped,
  )

const cutRowsOf = async (ctx: HandoffContext): Promise<V2Event[]> =>
  (await rowsOf(ctx)).filter(
    (event) => event.type === 'assistant-said' && event.interrupted === true,
  )

const resumedRepliesOf = async (ctx: HandoffContext): Promise<readonly ReadEvent[]> =>
  (await ctx.events()).filter(
    (row) =>
      row.type === 'assistant-said' &&
      JSON.stringify((row.event as { parts?: unknown }).parts ?? []).includes(RESUMED_TEXT),
  )

const expectOneResume = async (ctx: HandoffContext): Promise<void> => {
  await waitUntil({
    what: 'the resumed turn to finish once',
    check: async () => {
      const ends = await endsOf(ctx)
      const completed = ends.filter(
        (event) => event.type === 'turn-ended' && event.outcome === ETurnOutcome.Completed,
      )
      return (
        (await markersOf(ctx)).length === 1 &&
        (await resumedStartsOf(ctx)).length === 1 &&
        completed.length >= 1 &&
        (await resumedRepliesOf(ctx)).length === 1
      )
    },
  })
  const markers = await markersOf(ctx)
  const cutRows = await cutRowsOf(ctx)
  const cut = cutRows[0]
  expect(markers).toHaveLength(1)
  expect(markers[0]).toMatchObject({ point: EResumePoint.Clean })
  expect(cut).toBeDefined()
  if (cut === undefined || markers[0]?.type !== 'resume-marked') return
  expect(markers[0].discards).toEqual([{ fromSeq: cut.seq, throughSeq: cut.seq }])
  expect(await resumedStartsOf(ctx)).toHaveLength(1)
  const completed = (await endsOf(ctx)).filter(
    (event) => event.type === 'turn-ended' && event.outcome === ETurnOutcome.Completed,
  )
  expect(completed).toHaveLength(1)
  expect(completed[0]).toMatchObject({ by: ETurnEndedBy.Agent })
  expect(await resumedRepliesOf(ctx)).toHaveLength(1)
}

describeHandoff({
  name: 'a resume command lands one marker and runs the turn once across a host kill',
  prompt: 'run the suite',

  async start(ctx): Promise<HostProcess> {
    const chunk = ctx.path('chunk')
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      firstChunkFile: chunk,
      scripts: {
        [ctx.sessionId]: [{ text: CUT_TEXT.repeat(20), streamMs: 20_000 }, { text: RESUMED_TEXT }],
      },
      knobs: { fault: EHostFault.CommandOutcomeHangs },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await ctx.waitFor('chunk', 30_000)
    await ctx.rig.plane.post({
      sessionId: ctx.sessionId,
      kind: INBOX_KIND_STOP,
      payload: '{}',
    })
    await waitUntil({
      what: 'the stop to end the turn',
      check: async () => (await stoppedEndsOf(ctx)).length === 1,
    })
    await ctx.rig.plane.post({
      sessionId: ctx.sessionId,
      kind: 'command:resume',
      payload: JSON.stringify({}),
    })
    await ctx.rig.wake(ctx.sessionId)
    await waitUntil({
      what: 'host a to consume the resume command',
      check: async () => (await consumedOf(ctx)).length === 1,
    })
    return hostA
  },

  takeOverScripts({ sessionId }) {
    return { [sessionId]: [{ text: RESUMED_TEXT }] }
  },

  async inFlight(ctx) {
    expect((await consumedOf(ctx)).length).toBe(1)
    expect((await markersOf(ctx)).length).toBeLessThanOrEqual(1)
    expect((await resumedStartsOf(ctx)).length).toBeLessThanOrEqual(1)
    expect(await stoppedEndsOf(ctx)).toHaveLength(1)
  },

  async release() {},

  async settled(ctx) {
    await expectOneResume(ctx)
  },

  async runs(ctx) {
    return (await resumedRepliesOf(ctx)).length
  },

  async interrupted(ctx) {
    await expectOneResume(ctx)
  },
})

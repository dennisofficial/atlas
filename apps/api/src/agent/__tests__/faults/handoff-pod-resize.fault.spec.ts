import {
  EMessageOrigin,
  EPodResizeNotice,
  ETurnOutcome,
  INBOX_KIND_RECORD,
  inboxEventPayloadOf,
} from '@dltech/atlas-core'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'
import { expect } from 'bun:test'

import { callIdOf, expectOneResultPerDispatch, isDoneResult } from './fault-support'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import type { HostProcess, ReadEvent } from '../../testing/fault-rig'

const CALL_ID = 'c1'
const LATER_CALL_ID = 'c2'
const GENERATION = 4
const SHAPE = { vcpus: 8, memoryGb: 32 }
const INTERRUPT = 'was interrupted because the pod is being resized to 8 vCPU / 32 GB'

const rowsOf = async (args: { ctx: HandoffContext; type: string }): Promise<readonly ReadEvent[]> =>
  (await args.ctx.record()).filter((row) => row.type === args.type)

const callRowsOf = async (args: {
  ctx: HandoffContext
  type: string
  callId: string
}): Promise<readonly ReadEvent[]> =>
  (await rowsOf({ ctx: args.ctx, type: args.type })).filter((row) => callIdOf(row) === args.callId)

const dispatchesOf = (args: { ctx: HandoffContext; callId: string }) =>
  callRowsOf({ ctx: args.ctx, type: 'tool-dispatched', callId: args.callId })

const resultsOf = (args: { ctx: HandoffContext; callId: string }) =>
  callRowsOf({ ctx: args.ctx, type: 'tool-result', callId: args.callId })

const interruptedOf = (row: ReadEvent | undefined): boolean =>
  (row?.event as { interrupted?: boolean } | undefined)?.interrupted === true

const messageOf = (row: ReadEvent | undefined): string | undefined =>
  (row?.event as { error?: { message?: string } } | undefined)?.error?.message

const bootIdOf = (row: ReadEvent | undefined): string | undefined =>
  (row?.event as { bootId?: string } | undefined)?.bootId

const outcomeOf = (row: ReadEvent): unknown => (row.event as { outcome?: unknown }).outcome

const postStarted = async (ctx: HandoffContext): Promise<void> => {
  await ctx.rig.plane.post({
    sessionId: ctx.sessionId,
    kind: INBOX_KIND_RECORD,
    payload: inboxEventPayloadOf({
      event: { type: 'pod-resize-started', ...SHAPE, generation: GENERATION },
    }),
  })
}

const postResized = async (ctx: HandoffContext): Promise<void> => {
  await ctx.rig.plane.post({
    sessionId: ctx.sessionId,
    kind: INBOX_KIND_RECORD,
    payload: inboxEventPayloadOf({
      event: {
        type: 'pod-resized',
        ...SHAPE,
        generation: GENERATION,
        outcome: EPodResizeNotice.Applied,
      },
    }),
  })
}

const postLaterMessage = async (ctx: HandoffContext): Promise<void> => {
  await ctx.rig.plane.post({
    sessionId: ctx.sessionId,
    kind: INBOX_KIND_MESSAGE,
    payload: JSON.stringify({ text: 'run it again', via: EMessageOrigin.Operator }),
  })
  await ctx.rig.wake(ctx.sessionId)
}

const expectNoFailure = async (ctx: HandoffContext): Promise<void> => {
  expect(await rowsOf({ ctx, type: 'turn-failed' })).toHaveLength(0)
  expect(await rowsOf({ ctx, type: 'run-failed' })).toHaveLength(0)
}

const expectTurnsEnded = async (args: {
  ctx: HandoffContext
  count: number
  timeoutMs?: number
}): Promise<void> => {
  await waitUntil({
    what: `${args.count} completed turn(s)`,
    check: async () =>
      (await rowsOf({ ctx: args.ctx, type: 'turn-ended' })).filter(
        (row) => outcomeOf(row) === ETurnOutcome.Completed,
      ).length === args.count,
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
  })
  const ends = await rowsOf({ ctx: args.ctx, type: 'turn-ended' })
  expect(ends.filter((row) => outcomeOf(row) !== ETurnOutcome.Completed)).toHaveLength(0)
}

const expectInterruptedWithResize = async (ctx: HandoffContext): Promise<void> => {
  const results = await resultsOf({ ctx, callId: CALL_ID })
  expect(results).toHaveLength(1)
  expect(interruptedOf(results[0])).toBe(true)
  expect(messageOf(results[0])).toContain(INTERRUPT)
  expect(await dispatchesOf({ ctx, callId: CALL_ID })).toHaveLength(1)
}

const expectLaterBashBlocked = async (ctx: HandoffContext): Promise<void> => {
  await waitUntil({
    what: 'the turn after the interrupt to start',
    check: async () => (await rowsOf({ ctx, type: 'turn-started' })).length === 2,
    timeoutMs: 60_000,
  })
  expect(await dispatchesOf({ ctx, callId: LATER_CALL_ID })).toHaveLength(0)
  await postResized(ctx)
}

const expectLaterBashRan = async (ctx: HandoffContext): Promise<void> => {
  await waitUntil({
    what: 'the bash dispatched after the notice to finish',
    check: async () =>
      (await resultsOf({ ctx, callId: LATER_CALL_ID })).filter(isDoneResult).length === 1,
    timeoutMs: 60_000,
  })
  expect(await dispatchesOf({ ctx, callId: LATER_CALL_ID })).toHaveLength(1)
  expect(await resultsOf({ ctx, callId: LATER_CALL_ID })).toHaveLength(1)
  expectOneResultPerDispatch(await ctx.record())
  expect(await rowsOf({ ctx, type: 'pod-resized' })).toHaveLength(1)
  await expectTurnsEnded({ ctx, count: 2 })
  await expectNoFailure(ctx)
}

const bootIdsOf = async (
  ctx: HandoffContext,
): Promise<{ first: string | undefined; later: string | undefined }> => ({
  first: bootIdOf((await dispatchesOf({ ctx, callId: CALL_ID }))[0]),
  later: bootIdOf((await dispatchesOf({ ctx, callId: LATER_CALL_ID }))[0]),
})

describeHandoff({
  name: 'a bash call interrupted by a pod resize that restarts the pod',
  prompt: 'run a command that blocks on a gate',

  async start(ctx): Promise<HostProcess> {
    const started = ctx.path('started')
    const runs = ctx.path('runs')
    const gate = ctx.gate('gate')
    const command = `touch ${started}; echo run >> ${runs}; cat ${gate}; echo done`
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      scripts: {
        [ctx.sessionId]: [
          { calls: [{ callId: CALL_ID, name: 'bash', input: { description: 'wait', command } }] },
          { text: 'host a finished the resized turn' },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the bash call to be dispatched',
      check: async () => (await dispatchesOf({ ctx, callId: CALL_ID })).length === 1,
    })
    await ctx.waitFor('started', 30_000)
    await postStarted(ctx)
    await waitUntil({
      what: 'the running bash to come back interrupted',
      check: async () => (await resultsOf({ ctx, callId: CALL_ID })).length === 1,
      timeoutMs: 60_000,
    })
    await expectInterruptedWithResize(ctx)
    expect(await rowsOf({ ctx, type: 'pod-resize-started' })).toHaveLength(1)
    await expectTurnsEnded({ ctx, count: 1, timeoutMs: 60_000 })
    await expectNoFailure(ctx)
    return hostA
  },

  takeOverScripts({ sessionId }) {
    return {
      [sessionId]: [
        {
          calls: [
            {
              callId: LATER_CALL_ID,
              name: 'bash',
              input: { description: 'run it again', command: 'echo done' },
            },
          ],
        },
        { text: 'host b finished' },
      ],
    }
  },

  async inFlight(ctx) {
    await expectInterruptedWithResize(ctx)
    expect(await dispatchesOf({ ctx, callId: LATER_CALL_ID })).toHaveLength(0)
    expect(await rowsOf({ ctx, type: 'pod-resize-started' })).toHaveLength(1)
    expect(await rowsOf({ ctx, type: 'pod-resized' })).toHaveLength(0)
    await expectNoFailure(ctx)
  },

  async wake(ctx) {
    await postLaterMessage(ctx)
  },

  async release(ctx) {
    await expectLaterBashBlocked(ctx)
  },

  async settled(ctx) {
    await expectLaterBashRan(ctx)
    const { first, later } = await bootIdsOf(ctx)
    expect(later).toBe(first)
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    await expectInterruptedWithResize(ctx)
    const { first } = await bootIdsOf(ctx)
    await expectLaterBashBlocked(ctx)
    await expectLaterBashRan(ctx)
    const { later } = await bootIdsOf(ctx)
    expect(later).toBe(ctx.daemon.bootId)
    expect(later).not.toBe(first)
  },
})

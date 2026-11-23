import { expect } from 'bun:test'

import { callIdOf } from './fault-support'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import type { HostProcess, ReadEvent } from '../../testing/fault-rig'

const CALL_ID = 'c1'
const HOLD_CALL_ID = 'c2'

const rowsOf = async (args: {
  ctx: HandoffContext
  type: string
  callId?: string
}): Promise<readonly ReadEvent[]> =>
  (await args.ctx.record()).filter(
    (row) => row.type === args.type && (args.callId === undefined || callIdOf(row) === args.callId),
  )

const dispatchesOf = (ctx: HandoffContext) =>
  rowsOf({ ctx, type: 'tool-dispatched', callId: CALL_ID })

const resultsOf = (ctx: HandoffContext) => rowsOf({ ctx, type: 'tool-result', callId: CALL_ID })

const startedRows = (ctx: HandoffContext) => rowsOf({ ctx, type: 'background-shell-started' })

const endedRows = (ctx: HandoffContext) => rowsOf({ ctx, type: 'background-shell-ended' })

const backgroundedOf = (row: ReadEvent | undefined): boolean => {
  const event: { output?: { backgrounded?: unknown } } = row?.event ?? {}
  return event.output?.backgrounded === true
}

describeHandoff({
  name: 'a bash call handed over to a background shell',
  prompt: 'run a command that blocks on a gate',
  knobs: { plugins: true },

  async start(ctx): Promise<HostProcess> {
    const started = ctx.path('started')
    const runs = ctx.path('runs')
    const gate = ctx.gate('gate')
    const hold = ctx.gate('hold')
    const command = `touch ${started}; echo run >> ${runs}; cat ${gate}; echo done`
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      knobs: { plugins: true },
      scripts: {
        [ctx.sessionId]: [
          {
            calls: [
              {
                callId: CALL_ID,
                name: 'bash',
                input: { description: 'wait for the gate', command, timeoutMs: 1_000 },
              },
            ],
          },
          {
            calls: [
              {
                callId: HOLD_CALL_ID,
                name: 'bash',
                input: { description: 'hold the turn', command: `cat ${hold}` },
              },
            ],
          },
          { text: 'host a finished' },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the bash call to be dispatched',
      check: async () => (await dispatchesOf(ctx)).length === 1,
    })
    await ctx.waitFor('started', 30_000)
    await waitUntil({
      what: 'the bash call to be handed over',
      check: async () => (await resultsOf(ctx)).length === 1,
    })
    await waitUntil({
      what: 'the turn to still hold the session open',
      check: async () =>
        (await rowsOf({ ctx, type: 'tool-dispatched', callId: HOLD_CALL_ID })).length === 1,
    })
    return hostA
  },

  async inFlight(ctx) {
    const results = await resultsOf(ctx)
    expect(results).toHaveLength(1)
    expect(backgroundedOf(results[0])).toBe(true)
    expect(await startedRows(ctx)).toHaveLength(1)
    expect(await endedRows(ctx)).toHaveLength(0)
  },

  async release(ctx) {
    await ctx.release('gate')
    await ctx.release('hold')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the handed-over shell to report its ending',
      check: async () => (await endedRows(ctx)).length === 1,
    })
    expect(await resultsOf(ctx)).toHaveLength(1)
    expect(backgroundedOf((await resultsOf(ctx))[0])).toBe(true)
    expect(await startedRows(ctx)).toHaveLength(1)
    expect(await endedRows(ctx)).toHaveLength(1)
    expect(await dispatchesOf(ctx)).toHaveLength(1)
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    expect(await resultsOf(ctx)).toHaveLength(1)
    expect(backgroundedOf((await resultsOf(ctx))[0])).toBe(true)
    expect(await startedRows(ctx)).toHaveLength(1)
    expect(await dispatchesOf(ctx)).toHaveLength(1)
  },
})

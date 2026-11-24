import { expect } from 'bun:test'

import { callIdOf } from './fault-support'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import type { HostProcess, ReadEvent } from '../../testing/fault-rig'

const CALL_ID = 'shell1'

const rowsOf = async (args: {
  ctx: HandoffContext
  type: string
  callId?: string
}): Promise<readonly ReadEvent[]> =>
  (await args.ctx.record()).filter(
    (row) => row.type === args.type && (args.callId === undefined || callIdOf(row) === args.callId),
  )

const startedRows = (ctx: HandoffContext) => rowsOf({ ctx, type: 'background-shell-started' })

const endedRows = (ctx: HandoffContext) => rowsOf({ ctx, type: 'background-shell-ended' })

const dispatchesOf = (ctx: HandoffContext) =>
  rowsOf({ ctx, type: 'tool-dispatched', callId: CALL_ID })

describeHandoff({
  name: 'a background shell that outlives the turn that started it',
  prompt: 'start a long command in the background and end your turn',
  knobs: { plugins: true },

  async start(ctx): Promise<HostProcess> {
    const started = ctx.path('started')
    const runs = ctx.path('runs')
    const gate = ctx.gate('gate')
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
                input: { description: 'wait for the gate', command, background: true },
              },
            ],
          },
          { text: 'started it, ending the turn' },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await ctx.waitFor('started', 30_000)
    await waitUntil({
      what: 'the turn to end with only the shell left open',
      check: async () => (await rowsOf({ ctx, type: 'turn-ended' })).length === 1,
    })
    return hostA
  },

  async inFlight(ctx) {
    expect(await startedRows(ctx)).toHaveLength(1)
    expect(await endedRows(ctx)).toHaveLength(0)
  },

  async release(ctx) {
    await ctx.release('gate')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the shell to report its ending to the next holder',
      check: async () => (await endedRows(ctx)).length === 1,
    })
    expect(await startedRows(ctx)).toHaveLength(1)
    expect(await endedRows(ctx)).toHaveLength(1)
    expect(await dispatchesOf(ctx)).toHaveLength(1)
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    expect(await startedRows(ctx)).toHaveLength(1)
    expect(await dispatchesOf(ctx)).toHaveLength(1)
  },
})

import { expect } from 'bun:test'

import { callIdOf } from './fault-support'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import type { HostProcess, ReadEvent } from '../../testing/fault-rig'

const CALL_ID = 'c1'
const TIMEOUT_MS = 8_000
const UNCLAIMED_MS = 2_000
const SLACK_MS = 1_000

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const rowsOf = async (args: { ctx: HandoffContext; type: string }): Promise<readonly ReadEvent[]> =>
  (await args.ctx.record()).filter((row) => row.type === args.type && callIdOf(row) === CALL_ID)

const dispatchesOf = (ctx: HandoffContext) => rowsOf({ ctx, type: 'tool-dispatched' })

const resultsOf = (ctx: HandoffContext) => rowsOf({ ctx, type: 'tool-result' })

const endedRows = async (ctx: HandoffContext): Promise<readonly ReadEvent[]> =>
  (await ctx.record()).filter((row) => row.type === 'background-shell-ended')

const atOf = (row: ReadEvent): number => Date.parse((row.event as { at: string }).at)

const backgroundedOf = (row: ReadEvent | undefined): boolean => {
  const event: { output?: { backgrounded?: unknown } } = row?.event ?? {}
  return event.output?.backgrounded === true
}

describeHandoff({
  name: 'a bash call whose foreground deadline the daemon owns',
  prompt: 'run a command that blocks on a gate',
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
                input: { description: 'wait for the gate', command, timeoutMs: TIMEOUT_MS },
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
    return hostA
  },

  async wake() {
    await sleep(UNCLAIMED_MS)
  },

  async inFlight(ctx) {
    await waitUntil({
      what: 'the bash call to report its end at its original deadline',
      check: async () => (await resultsOf(ctx)).length === 1,
      timeoutMs: 20_000,
    })
    const results = await resultsOf(ctx)
    const dispatches = await dispatchesOf(ctx)
    const dispatched = dispatches[0]
    const settled = results[0]
    if (dispatched === undefined || settled === undefined) throw new Error('no call rows')

    expect(backgroundedOf(settled)).toBe(true)
    expect(dispatches).toHaveLength(1)
    const elapsed = atOf(settled) - atOf(dispatched)
    expect(elapsed).toBeLessThanOrEqual(TIMEOUT_MS + SLACK_MS)
    expect(elapsed).toBeLessThan(2 * TIMEOUT_MS)
  },

  async release(ctx) {
    await ctx.release('gate')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the handed-over shell to report its ending',
      check: async () => (await endedRows(ctx)).length === 1,
      timeoutMs: 30_000,
    })
    expect(await resultsOf(ctx)).toHaveLength(1)
    expect(backgroundedOf((await resultsOf(ctx))[0])).toBe(true)
    expect(await dispatchesOf(ctx)).toHaveLength(1)
    expect(await endedRows(ctx)).toHaveLength(1)
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },
})

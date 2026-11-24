import { expect } from 'bun:test'

import { callIdOf } from './fault-support'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import type { HostProcess } from '../../testing/fault-rig'

const CALL_ID = 'c1'
const PORT = 42_000 + (process.pid % 1_000)

const dispatchesOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-dispatched' && callIdOf(row) === CALL_ID)

const resultsOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-result' && callIdOf(row) === CALL_ID)

const interruptedOf = (row: { event: unknown }): boolean =>
  (row.event as { interrupted?: boolean }).interrupted === true

describeHandoff({
  name: 'a service start that outlives the turn',
  prompt: 'start the service',

  async start(ctx): Promise<HostProcess> {
    const started = ctx.path('started')
    const runs = ctx.path('runs')
    const gate = ctx.gate('gate')
    const command = `touch ${started}; echo run >> ${runs}; cat ${gate}; exec bun -e 'Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response("ok") })'`
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      scripts: {
        [ctx.sessionId]: [
          {
            calls: [
              {
                callId: CALL_ID,
                name: 'service',
                input: {
                  action: 'start',
                  command,
                  description: 'a gated listener',
                  cwd: ctx.workspace,
                  port: PORT,
                  readyTimeoutMs: 60_000,
                },
              },
            ],
          },
          { text: 'host a finished' },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the service call to be dispatched',
      check: async () => (await dispatchesOf(ctx)).length === 1,
    })
    await ctx.waitFor('started', 30_000)
    return hostA
  },

  async inFlight(ctx) {
    expect(await dispatchesOf(ctx)).toHaveLength(1)
    expect(await resultsOf(ctx)).toHaveLength(0)
  },

  async release(ctx) {
    await ctx.release('gate')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the service call to report its real result',
      check: async () => (await resultsOf(ctx)).length === 1,
    })
    const results = await resultsOf(ctx)
    expect(results.filter(interruptedOf)).toHaveLength(0)
    expect(await dispatchesOf(ctx)).toHaveLength(1)
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    await waitUntil({
      what: 'the service result',
      check: async () => (await resultsOf(ctx)).length === 1,
    })
    const results = await resultsOf(ctx)
    expect(results.filter(interruptedOf)).toHaveLength(1)
    expect(await dispatchesOf(ctx)).toHaveLength(1)
  },
})

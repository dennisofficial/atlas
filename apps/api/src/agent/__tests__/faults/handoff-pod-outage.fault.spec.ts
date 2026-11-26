import { expect } from 'bun:test'

import { callIdOf, isDoneResult } from './fault-support'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import type { HostProcess } from '../../testing/fault-rig'

const CALL_ID = 'c1'
const REJOIN_MS = 1_000
const HELD_MS = 1_500

const KNOBS = { pingMs: 500 }

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const dispatchesOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-dispatched' && callIdOf(row) === CALL_ID)

const resultsOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-result' && callIdOf(row) === CALL_ID)

const interruptedEverywhereOf = async (ctx: HandoffContext): Promise<readonly string[]> =>
  (await ctx.events())
    .filter((row) => /interrupt/i.test(JSON.stringify(row.event)))
    .map((row) => `${row.seq}:${row.type}`)

describeHandoff({
  name: 'a bash call whose takeover meets the pod link down',
  prompt: 'sleep then echo',
  knobs: KNOBS,

  async start(ctx): Promise<HostProcess> {
    const started = ctx.path('started')
    const runs = ctx.path('runs')
    const gate = ctx.gate('gate')
    const bash = `touch ${started}; echo run >> ${runs}; cat ${gate}; echo done`
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      knobs: KNOBS,
      scripts: {
        [ctx.sessionId]: [
          {
            calls: [
              { callId: CALL_ID, name: 'bash', input: { description: 'sleep', command: bash } },
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

  async beforeClaim(ctx) {
    ctx.daemon.proxy.set({ blackhole: true })
  },

  async inFlight(ctx) {
    expect(await dispatchesOf(ctx)).toHaveLength(1)
    expect(await resultsOf(ctx)).toHaveLength(0)

    ctx.daemon.proxy.clear()
    await waitUntil({
      what: 'host b to reach the pod',
      check: async () => ctx.daemon.proxy.connections() > 0,
    })
    await sleep(REJOIN_MS)

    ctx.daemon.proxy.set({ blackhole: true })
    ctx.daemon.proxy.drop()
    await sleep(HELD_MS)

    expect(await dispatchesOf(ctx)).toHaveLength(1)
    expect(await resultsOf(ctx)).toHaveLength(0)
    expect(await interruptedEverywhereOf(ctx)).toEqual([])
  },

  async release(ctx) {
    ctx.daemon.proxy.clear()
    await ctx.release('gate')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the bash call to report its end',
      check: async () => (await resultsOf(ctx)).filter(isDoneResult).length === 1,
    })
    expect(await dispatchesOf(ctx)).toHaveLength(1)
    expect(await resultsOf(ctx)).toHaveLength(1)
    expect(await interruptedEverywhereOf(ctx)).toEqual([])
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },
})

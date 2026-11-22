import { expect } from 'bun:test'

import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import type { HostProcess } from '../../testing/fault-rig'
import { callIdOf, isDoneResult } from './fault-support'

const CALL_ID = 'c1'

const dispatchedOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-dispatched' && callIdOf(row) === CALL_ID)

const calledOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-called' && callIdOf(row) === CALL_ID)

const resultsOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-result' && callIdOf(row) === CALL_ID)

describeHandoff({
  name: 'a message that starts the turn while the pod is still waking',
  prompt: 'run it',
  prepared: true,

  async start(ctx): Promise<HostProcess> {
    const runs = ctx.path('runs')
    ctx.daemon.proxy.set({ refuse: true })
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
                name: 'bash',
                input: { description: 'quick', command: `echo run >> ${runs}; echo done` },
              },
            ],
          },
          { text: 'host a finished' },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the model to ask for the bash call before the pod is up',
      check: async () => (await calledOf(ctx)).length === 1,
    })
    expect(ctx.daemon.proxy.connections()).toBe(0)
    expect(await resultsOf(ctx)).toHaveLength(0)
    return hostA
  },

  async inFlight(ctx) {
    expect(await calledOf(ctx)).toHaveLength(1)
    expect(await resultsOf(ctx)).toHaveLength(0)
  },

  async release(ctx) {
    ctx.daemon.proxy.clear()
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the bash call to report its end',
      check: async () => (await resultsOf(ctx)).filter(isDoneResult).length === 1,
    })
    expect(await calledOf(ctx)).toHaveLength(1)
    expect(await resultsOf(ctx)).toHaveLength(1)
    expect(await dispatchedOf(ctx)).toHaveLength(1)
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    ctx.daemon.proxy.clear()
    await waitUntil({
      what: 'the bash call that never reached the pod to run after the restart',
      check: async () => (await resultsOf(ctx)).filter(isDoneResult).length === 1,
    })
    expect(await calledOf(ctx)).toHaveLength(1)
    expect(await resultsOf(ctx)).toHaveLength(1)
  },
})

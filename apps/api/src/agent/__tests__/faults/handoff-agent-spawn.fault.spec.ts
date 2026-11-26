import type { SubagentSnapshot } from '@dltech/atlas-plugin-sdk'
import { expect } from 'bun:test'

import type { HostProcess } from '../../testing/fault-rig'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import { callIdOf } from './fault-support'

const CALL_ID = 'c1'
const GATE = { tool: 'agent_spawn', phase: 'after' as const, waitFor: '' }

const rowsOf = async (
  ctx: HandoffContext,
  type: 'tool-dispatched' | 'tool-result' | 'agent-spawned',
) =>
  (await ctx.events()).filter((row) =>
    type === 'agent-spawned' ? row.type === type : row.type === type && callIdOf(row) === CALL_ID,
  )

const dispatchedOf = async (ctx: HandoffContext): Promise<number> =>
  (await rowsOf(ctx, 'tool-dispatched')).length

const resultsOf = async (ctx: HandoffContext) => await rowsOf(ctx, 'tool-result')

const spawnedOf = async (ctx: HandoffContext): Promise<readonly string[]> =>
  (await rowsOf(ctx, 'agent-spawned')).map((row) => (row.event as { agentId: string }).agentId)

const outputAgentIdOf = (row: { event: unknown }): string | undefined =>
  (row.event as { output?: SubagentSnapshot }).output?.agentId

const interruptedOf = (row: { event: unknown }): boolean => {
  const event = row.event as { interrupted?: boolean; error?: { message: string } }
  return event.interrupted === true || /interrupt/i.test(event.error?.message ?? '')
}

describeHandoff({
  name: 'a sub-agent spawn whose result never reached the log',
  prompt: 'spawn a helper',
  drain: false,
  knobs: { plugins: true, pluginToolGate: GATE },

  async start(ctx): Promise<HostProcess> {
    GATE.waitFor = ctx.path('gate')
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      knobs: { plugins: true, pluginToolGate: GATE },
      scripts: {
        [ctx.sessionId]: [
          {
            calls: [
              {
                callId: CALL_ID,
                name: 'agent_spawn',
                input: {
                  agentType: 'explore',
                  intent: 'read the port',
                  brief: 'read the port of the session and report what it holds',
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
      what: 'the spawn to record its child in the parent log',
      check: async () => (await spawnedOf(ctx)).length === 1,
    })
    return hostA
  },

  async inFlight(ctx) {
    expect(await dispatchedOf(ctx)).toBe(1)
    expect(await resultsOf(ctx)).toHaveLength(0)
    expect(await spawnedOf(ctx)).toHaveLength(1)
  },

  async release(ctx) {
    await Bun.write(ctx.path('gate'), 'go\n')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the spawn to report its result',
      check: async () => (await resultsOf(ctx)).length === 1,
    })
    const results = await resultsOf(ctx)
    expect(results.filter(interruptedOf)).toHaveLength(0)
    expect(await dispatchedOf(ctx)).toBe(1)
    const spawned = await spawnedOf(ctx)
    expect(spawned).toHaveLength(1)
    expect(outputAgentIdOf(results[0] ?? { event: {} })).toBe(spawned[0])
  },

  async runs(ctx) {
    return (await spawnedOf(ctx)).length
  },
})

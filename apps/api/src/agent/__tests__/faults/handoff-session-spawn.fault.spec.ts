import { expect } from 'bun:test'

import type { HostProcess } from '../../testing/fault-rig'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import { callIdOf } from './fault-support'

const CALL_ID = 'c1'
const GATE = { tool: 'spawn_session', phase: 'after' as const, waitFor: '' }

const rowsOf = async (ctx: HandoffContext, type: 'tool-dispatched' | 'tool-result') =>
  (await ctx.events()).filter((row) => row.type === type && callIdOf(row) === CALL_ID)

const spawnedOf = async (ctx: HandoffContext): Promise<readonly string[]> => {
  const roster = await ctx.rig.plane.sessionsOf({ sessionId: ctx.sessionId })
  return roster.sessions
    .filter((row) => row.spawnedBySessionId === ctx.sessionId)
    .map((row) => row.sessionId)
}

const outputSessionIdOf = (row: { event: unknown }): string | undefined =>
  (row.event as { output?: { sessionId?: string } }).output?.sessionId

const interruptedOf = (row: { event: unknown }): boolean => {
  const event = row.event as { interrupted?: boolean; error?: { message: string } }
  return event.interrupted === true || /interrupt/i.test(event.error?.message ?? '')
}

describeHandoff({
  name: 'a peer session spawn whose result never reached the log',
  prompt: 'start a session of its own',
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
                name: 'spawn_session',
                input: { title: 'the peer', brief: 'read the port of this project' },
              },
            ],
          },
          { text: 'host a finished' },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the spawn to record its session',
      check: async () => (await spawnedOf(ctx)).length === 1,
    })
    return hostA
  },

  async inFlight(ctx) {
    expect(await rowsOf(ctx, 'tool-dispatched')).toHaveLength(1)
    expect(await rowsOf(ctx, 'tool-result')).toHaveLength(0)
    expect(await spawnedOf(ctx)).toHaveLength(1)
  },

  async release(ctx) {
    await Bun.write(ctx.path('gate'), 'go\n')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the spawn to report its result',
      check: async () => (await rowsOf(ctx, 'tool-result')).length === 1,
    })
    const results = await rowsOf(ctx, 'tool-result')
    expect(results.filter(interruptedOf)).toHaveLength(0)
    expect(await rowsOf(ctx, 'tool-dispatched')).toHaveLength(1)
    const spawned = await spawnedOf(ctx)
    expect(spawned).toHaveLength(1)
    expect(outputSessionIdOf(results[0] ?? { event: {} })).toBe(spawned[0])
  },

  async runs(ctx) {
    return (await spawnedOf(ctx)).length
  },
})

import type { V2Event } from '@dltech/atlas-core'
import { expect } from 'bun:test'

import { callIdOf } from './fault-support'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import type { HostProcess } from '../../testing/fault-rig'

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const CALL_ID = 'c1'
const PROMPT = `SPAWN-HANDOFF-${RUN} start a sub-agent`
const BRIEF = `SPAWN-HANDOFF-${RUN}-BRIEF say the word`
const CHILD_TEXT = `SPAWN-HANDOFF-${RUN}-CHILD-DONE`
const PARENT_TEXT = `SPAWN-HANDOFF-${RUN}-PARENT-DONE`

const eventsOf = async (ctx: HandoffContext): Promise<V2Event[]> =>
  (await ctx.record()).map((row) => row.event as V2Event)

type Spawned = Extract<V2Event, { type: 'agent-spawned' }>

const spawnedOf = async (ctx: HandoffContext): Promise<Spawned[]> =>
  (await eventsOf(ctx)).filter((event): event is Spawned => event.type === 'agent-spawned')

const resultsOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-result' && callIdOf(row) === CALL_ID)

const dispatchesOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-dispatched' && callIdOf(row) === CALL_ID)

const interruptedOf = (row: { event: unknown }): boolean => {
  const event = row.event as { interrupted?: boolean; error?: { message: string } }
  if (event.interrupted === true) return true
  return event.error !== undefined && /interrupt/i.test(event.error.message)
}

type SpawnResult = {
  output?: { agentId?: string }
  error?: { message: string }
}

const spawnResultOf = async (ctx: HandoffContext): Promise<SpawnResult> => {
  const [first] = await resultsOf(ctx)
  if (first === undefined) throw new Error('the spawn call reported no result')
  return first.event as SpawnResult
}

const endedOf = async (ctx: HandoffContext, agentId: string): Promise<boolean> =>
  (await eventsOf(ctx)).some((event) => event.type === 'agent-ended' && event.agentId === agentId)

describeHandoff({
  name: 'a sub-agent spawn that outlives a host handoff',
  prompt: PROMPT,
  knobs: { plugins: true },
  drain: false,

  takeOverScripts({ sessionId }) {
    return {
      [`${sessionId}#${PROMPT}@host-b`]: [{ text: PARENT_TEXT }],
      [`${sessionId}#${BRIEF}@host-b`]: [{ text: CHILD_TEXT }],
    }
  },

  async start(ctx): Promise<HostProcess> {
    const heldAfterSpawn = ctx.path('held-after-spawn')
    const childGate = ctx.path('child-step-gate')
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      knobs: {
        plugins: true,
        pluginToolGate: { tool: 'agent_spawn', waitFor: heldAfterSpawn, phase: 'after' },
      },
      scripts: {
        [`${ctx.sessionId}#${PROMPT}@host-a`]: [
          {
            calls: [
              {
                callId: CALL_ID,
                name: 'agent_spawn',
                input: { agentType: 'general-purpose', intent: 'spawned', brief: BRIEF },
              },
            ],
          },
          { text: 'host a finished' },
        ],
        [`${ctx.sessionId}#${BRIEF}@host-a`]: [{ gateFile: childGate, text: CHILD_TEXT }],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the sub-agent to be recorded',
      check: async () => (await spawnedOf(ctx)).length === 1,
    })
    return hostA
  },

  async inFlight(ctx) {
    expect(await spawnedOf(ctx)).toHaveLength(1)
    expect(await dispatchesOf(ctx)).toHaveLength(1)
    expect(await resultsOf(ctx)).toHaveLength(0)
  },

  async release() {},

  async settled(ctx) {
    await waitUntil({
      what: 'the spawn call to report its real result',
      check: async () => (await resultsOf(ctx)).length === 1,
      timeoutMs: 60_000,
    })
    const results = await resultsOf(ctx)
    expect(results.filter(interruptedOf)).toHaveLength(0)
    expect(await dispatchesOf(ctx)).toHaveLength(1)

    const spawned = await spawnedOf(ctx)
    expect(spawned).toHaveLength(1)
    const child = spawned[0]
    if (child === undefined) throw new Error('the record carried no sub-agent')

    const result = await spawnResultOf(ctx)
    expect(result.error).toBeUndefined()
    expect(result.output?.agentId).toBe(child.agentId)

    await waitUntil({
      what: 'the sub-agent to be adopted and finish',
      check: async () => await endedOf(ctx, child.agentId),
      timeoutMs: 60_000,
    })
  },

  async runs(ctx) {
    return (await spawnedOf(ctx)).length
  },
})

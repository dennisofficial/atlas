import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { RecordEvent } from '@dltech/atlas-core'
import { expect } from 'bun:test'

import type { HostKnobs, HostProcess } from '../../testing/fault-rig'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const PROMPT = `AGENT-SPAWN-HANDOFF-${RUN} start one sub-agent`
const BRIEF = `AGENT-SPAWN-BRIEF-${RUN} answer the parent`
const CHILD_TEXT = `AGENT-SPAWN-CHILD-${RUN}`
const SPAWN_TURN_TEXT = `AGENT-SPAWN-PARENT-${RUN}`
const CALL_ID = 's1'
const NEVER = '/nonexistent/never-opens'

const KNOBS: HostKnobs = { plugins: true }

const parentEvents = async (ctx: HandoffContext): Promise<RecordEvent[]> =>
  (await ctx.record()).map((row) => row.event as RecordEvent)

const threadEventsOf = async (args: {
  ctx: HandoffContext
  threadId: string
}): Promise<RecordEvent[]> => {
  const page = await args.ctx.rig.plane.readEvents({
    threadId: args.threadId,
    afterSeq: 0,
    limit: 1_000,
    visible: false,
  })
  return [...page.events]
}

const ofType = <T extends RecordEvent['type']>(
  events: readonly RecordEvent[],
  type: T,
): Extract<RecordEvent, { type: T }>[] =>
  events.filter((event): event is Extract<RecordEvent, { type: T }> => event.type === type)

const spawnOf = (
  events: readonly RecordEvent[],
): Extract<RecordEvent, { type: 'agent-spawned' }> => {
  const spawned = ofType(events, 'agent-spawned')
  if (spawned.length !== 1) throw new Error(`the record held ${spawned.length} spawns, wanted 1`)
  return spawned[0] as Extract<RecordEvent, { type: 'agent-spawned' }>
}

const resultOf = (
  events: readonly RecordEvent[],
): Extract<RecordEvent, { type: 'tool-result' }> | undefined =>
  ofType(events, 'tool-result').find((event) => event.callId === CALL_ID)

const interruptedOf = (events: readonly RecordEvent[]): RecordEvent[] =>
  ofType(events, 'tool-result').filter((event) => event.interrupted === true)

const saidOf = (events: readonly RecordEvent[], text: string): boolean =>
  events.some((event) => event.type === 'assistant-said' && JSON.stringify(event).includes(text))

const briefsOf = (events: readonly RecordEvent[]): number =>
  events.filter((event) => event.type === 'user-said' && event.text.includes(BRIEF)).length

describeHandoff({
  name: 'a sub-agent spawned before its host is killed comes back to the same child',
  prompt: PROMPT,
  drain: false,
  podRestart: 'survives',
  knobs: KNOBS,

  takeOverScripts({ sessionId }) {
    return {
      [`${sessionId}#${PROMPT}@host-b`]: [{ text: SPAWN_TURN_TEXT }],
      [`${sessionId}#${BRIEF}@host-b`]: [{ text: CHILD_TEXT }],
    }
  },

  async start(ctx): Promise<HostProcess> {
    const held = ctx.path('held-spawn')
    KNOBS.pluginToolGate = { tool: 'agent_spawn', waitFor: held, phase: 'after' }
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      knobs: KNOBS,
      scripts: {
        [`${ctx.sessionId}#${PROMPT}@host-a`]: [
          {
            calls: [
              {
                callId: CALL_ID,
                name: 'agent_spawn',
                input: { agentType: 'general-purpose', intent: 'alpha', brief: BRIEF },
              },
            ],
          },
          { text: SPAWN_TURN_TEXT },
        ],
        [`${ctx.sessionId}#${BRIEF}@host-a`]: [{ gateFile: NEVER, text: 'never' }],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the spawn to be recorded',
      check: async () => ofType(await parentEvents(ctx), 'agent-spawned').length === 1,
      timeoutMs: 60_000,
    })
    await waitUntil({
      what: 'the child to be briefed',
      check: async () => {
        const child = spawnOf(await parentEvents(ctx))
        return briefsOf(await threadEventsOf({ ctx, threadId: child.agentId })) === 1
      },
      timeoutMs: 60_000,
    })
    return hostA
  },

  async inFlight(ctx) {
    const events = await parentEvents(ctx)
    spawnOf(events)
    expect(resultOf(events)).toBeUndefined()
    expect(interruptedOf(events)).toEqual([])
    const child = spawnOf(events)
    expect(briefsOf(await threadEventsOf({ ctx, threadId: child.agentId }))).toBe(1)
  },

  async release(ctx) {
    writeFileSync(join(ctx.workspace, 'held-spawn'), 'go')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the parent to record the spawn result',
      check: async () => resultOf(await parentEvents(ctx)) !== undefined,
      timeoutMs: 60_000,
    })
    const events = await parentEvents(ctx)
    const child = spawnOf(events)
    const result = resultOf(events)
    expect(result?.interrupted).toBeUndefined()
    expect((result?.output as { agentId?: string } | undefined)?.agentId).toBe(child.agentId)
    expect(child.callId).toBe(CALL_ID)
    expect(interruptedOf(events)).toEqual([])
    expect(briefsOf(await threadEventsOf({ ctx, threadId: child.agentId }))).toBe(1)
    await waitUntil({
      what: 'the child to finish its brief',
      check: async () => saidOf(await threadEventsOf({ ctx, threadId: child.agentId }), CHILD_TEXT),
      timeoutMs: 60_000,
    })
    await waitUntil({
      what: 'the parent to close its turn',
      check: async () => ofType(await parentEvents(ctx), 'turn-ended').length >= 1,
      timeoutMs: 60_000,
    })
  },

  async runs(ctx) {
    return ofType(await parentEvents(ctx), 'agent-spawned').length
  },
})

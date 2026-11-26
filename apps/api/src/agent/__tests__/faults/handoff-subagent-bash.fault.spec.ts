import { expect } from 'bun:test'

import type { HostKnobs, ReadEvent } from '../../testing/fault-rig'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import { callIdOf, isDoneResult } from './fault-support'

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

const PROMPT = `SUBAGENT-BASH-${RUN} run the gated command in a sub-agent`
const BRIEF = `GATED-BRIEF-${RUN} run the gated command`
const CHILD_TEXT = `CHILD-DONE-${RUN}`
const PARENT_TEXT = `PARENT-DONE-${RUN}`
const CALL_ID = 'c1'
const INTENT = 'gated'

const KNOBS: HostKnobs = { plugins: true }

const threadEventsOf = async (args: {
  ctx: HandoffContext
  threadId: string
}): Promise<ReadEvent[]> => {
  const page = await args.ctx.rig.plane.readEvents({
    threadId: args.threadId,
    afterSeq: 0,
    limit: 1_000,
    visible: false,
  })
  return page.events.map((row) => ({ seq: row.seq, type: row.type, event: row }))
}

const parentEvents = async (ctx: HandoffContext): Promise<ReadEvent[]> =>
  threadEventsOf({ ctx, threadId: ctx.threadId })

const spawnedSubAgents = (events: readonly ReadEvent[]): ReadEvent[] =>
  events.filter((row) => row.type === 'agent-spawned')

const childIdOf = (events: readonly ReadEvent[]): string => {
  const spawn = spawnedSubAgents(events).find(
    (row) => (row.event as { intent?: string }).intent === INTENT,
  )
  if (spawn === undefined) throw new Error(`the record never carried a sub-agent for ${INTENT}`)
  return (spawn.event as { agentId: string }).agentId
}

const childEventsOf = async (ctx: HandoffContext): Promise<ReadEvent[]> =>
  threadEventsOf({ ctx, threadId: childIdOf(await parentEvents(ctx)) })

const childCallsOf = async (args: {
  ctx: HandoffContext
  type: 'tool-dispatched' | 'tool-result'
}): Promise<ReadEvent[]> =>
  (await childEventsOf(args.ctx)).filter(
    (row) => row.type === args.type && callIdOf(row) === CALL_ID,
  )

describeHandoff({
  name: 'a sub-agent bash call that outlives a host handover',
  prompt: PROMPT,
  knobs: KNOBS,

  takeOverScripts({ sessionId }) {
    return {
      [`${sessionId}#${BRIEF}@host-b`]: [{ text: CHILD_TEXT }],
      [`${sessionId}#${PROMPT}@host-b`]: [{ text: PARENT_TEXT }],
    }
  },

  async start(ctx) {
    const runs = ctx.path('runs')
    const gate = ctx.gate('gate')
    const bash = `echo run >> ${runs}; cat ${gate}; echo done`
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
                callId: 's1',
                name: 'agent_spawn',
                input: { agentType: 'general-purpose', intent: INTENT, brief: BRIEF },
              },
            ],
          },
          { text: 'sub-agent started' },
        ],
        [`${ctx.sessionId}#${BRIEF}@host-a`]: [
          {
            calls: [
              { callId: CALL_ID, name: 'bash', input: { description: 'gated', command: bash } },
            ],
          },
          { text: CHILD_TEXT },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the sub-agent to be recorded',
      check: async () => spawnedSubAgents(await parentEvents(ctx)).length === 1,
    })
    await waitUntil({
      what: 'the sub-agent to dispatch its bash call',
      check: async () => (await childCallsOf({ ctx, type: 'tool-dispatched' })).length === 1,
    })
    await waitUntil({
      what: 'the gated command to start',
      check: async () => ctx.runCount('runs') === 1,
    })
    return hostA
  },

  async inFlight(ctx) {
    expect(await childCallsOf({ ctx, type: 'tool-dispatched' })).toHaveLength(1)
    expect(await childCallsOf({ ctx, type: 'tool-result' })).toHaveLength(0)
    expect(ctx.runCount('runs')).toBe(1)
  },

  async release(ctx) {
    await ctx.release('gate')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the sub-agent call to report its end',
      check: async () =>
        (await childCallsOf({ ctx, type: 'tool-result' })).filter(isDoneResult).length === 1,
      timeoutMs: 60_000,
    })
    const results = await childCallsOf({ ctx, type: 'tool-result' })
    expect(results).toHaveLength(1)
    expect(results.filter(isDoneResult)).toHaveLength(1)
    expect(await childCallsOf({ ctx, type: 'tool-dispatched' })).toHaveLength(1)
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    await waitUntil({
      what: 'the restarted pod to report the sub-agent call interrupted',
      check: async () =>
        (await childCallsOf({ ctx, type: 'tool-result' })).some(
          (row) => (row.event as { interrupted?: boolean }).interrupted === true,
        ),
      timeoutMs: 60_000,
    })
    const results = await childCallsOf({ ctx, type: 'tool-result' })
    expect(results).toHaveLength(1)
    expect(results.filter(isDoneResult)).toHaveLength(0)
    expect(await childCallsOf({ ctx, type: 'tool-dispatched' })).toHaveLength(1)
  },
})

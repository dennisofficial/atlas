import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { RecordEvent } from '@dltech/atlas-core'
import { expect } from 'bun:test'

import type { HostKnobs, HostProcess } from '../../testing/fault-rig'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import { recordedRequestsOf, type RecordedModelRequest } from '../../testing/model-requests'

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const REQUESTS = join(tmpdir(), `atlas-grouped-wake-requests-${RUN}.jsonl`)

const PROMPT = `GROUPED-WAKE-${RUN} start two sub-agents`
const BRIEF_ALPHA = `ALPHA-BRIEF-${RUN} answer at once`
const BRIEF_BETA = `BETA-BRIEF-${RUN} wait for the gate`
const ALPHA_TEXT = `ALPHA-DONE-${RUN}`
const BETA_TEXT = `BETA-DONE-${RUN}`
const WOKEN_TEXT = `WOKEN-ONCE-${RUN}`
const SPAWN_TURN_TEXT = 'waiting for the group'
const GATE_CALL = 'b1'
const NOTICE = 'agents-ended'

const KNOBS: HostKnobs = { plugins: true, modelRequestsFile: REQUESTS }

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

const childIdOf = (events: readonly RecordEvent[], intent: string): string => {
  const spawn = ofType(events, 'agent-spawned').find((event) => event.intent === intent)
  if (spawn === undefined) throw new Error(`the record never carried a sub-agent for ${intent}`)
  return spawn.agentId
}

const callOf = (event: RecordEvent): string | undefined => (event as { callId?: string }).callId

const saidOf = (events: readonly RecordEvent[], text: string): boolean =>
  events.some((event) => event.type === 'assistant-said' && JSON.stringify(event).includes(text))

const waitsForText = async (args: {
  ctx: HandoffContext
  what: string
  text: string
}): Promise<void> =>
  waitUntil({
    what: args.what,
    check: async () => saidOf(await parentEvents(args.ctx), args.text),
    timeoutMs: 60_000,
  })

const noticeIndexesOf = (request: RecordedModelRequest): number[] =>
  request.assembled.messages.flatMap((message, index) =>
    JSON.stringify(message.message).includes(NOTICE) ? [index] : [],
  )

const requestsWithEndings = (): RecordedModelRequest[] =>
  recordedRequestsOf(REQUESTS).filter((request) => noticeIndexesOf(request).length > 0)

const want = (args: { what: string; got: number; want: number }): void => {
  if (args.got !== args.want) {
    throw new Error(`${args.what}: the record held ${args.got}, wanted ${args.want}`)
  }
}

const expectOneGroupedWake = (): void => {
  const waking = requestsWithEndings()
  if (waking.length !== 1) {
    const seen = recordedRequestsOf(REQUESTS).map(
      (request) => `${request.host}/${request.sessionId}/${noticeIndexesOf(request).join('+')}`,
    )
    throw new Error(`waking requests: saw ${seen.join(' ')}`)
  }
  const indexes = noticeIndexesOf(waking[0] as RecordedModelRequest)
  want({ what: 'ending blocks in the waking request', got: indexes.length, want: 2 })
  want({
    what: 'the second block right after the first',
    got: indexes[1] ?? -1,
    want: (indexes[0] as number) + 1,
  })
}

const expectTwoTurns = async (ctx: HandoffContext): Promise<void> =>
  waitUntil({
    what: 'the wake turn to end',
    check: async () => ofType(await parentEvents(ctx), 'turn-ended').length === 2,
    timeoutMs: 60_000,
  })

const expectOneWakeTurn = async (ctx: HandoffContext): Promise<void> => {
  const events = await parentEvents(ctx)
  want({ what: 'parent turn starts', got: ofType(events, 'turn-started').length, want: 2 })
  want({ what: 'parent turn ends', got: ofType(events, 'turn-ended').length, want: 2 })
  want({ what: 'gated runs', got: await ctx.runCount('runs'), want: 1 })
}

const expectBothEndings = async (ctx: HandoffContext): Promise<void> => {
  const events = await parentEvents(ctx)
  const alpha = childIdOf(events, 'alpha')
  const beta = childIdOf(events, 'beta')
  const endings = ofType(events, 'agent-ended')
    .map((event) => String(event.agentId))
    .sort()
  const both = [alpha, beta].map(String).sort()
  if (endings.join(',') !== both.join(',')) {
    const seen = ofType(events, 'agent-ended')
      .map((event) => `${String(event.agentId)}@${event.seq}${event.held === true ? ' held' : ''}`)
      .join(' ')
    throw new Error(`parent endings: the record held ${seen}, wanted ${both.join(' ')}`)
  }
}

const settleAfterRelease = async (ctx: HandoffContext): Promise<void> => {
  await waitsForText({ ctx, what: 'the parent to answer once', text: WOKEN_TEXT })
  await expectTwoTurns(ctx)
  await expectOneWakeTurn(ctx)
  await expectBothEndings(ctx)
  expectOneGroupedWake()
}

describeHandoff({
  name: 'a group of sub-agents wakes the parent once with both endings',
  prompt: PROMPT,
  knobs: KNOBS,

  takeOverScripts({ sessionId }) {
    return {
      [`${sessionId}#${PROMPT}@host-b`]: [{ text: WOKEN_TEXT }],
      [`${sessionId}#${BRIEF_BETA}@host-b`]: [{ text: BETA_TEXT }],
    }
  },

  async start(ctx): Promise<HostProcess> {
    writeFileSync(REQUESTS, '')
    const runs = ctx.path('runs')
    const alphaGo = ctx.path('alpha-go')
    const gate = ctx.gate('gate')
    const gated = `echo run >> ${runs}; cat ${gate}; echo done`
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
                input: { agentType: 'general-purpose', intent: 'alpha', brief: BRIEF_ALPHA },
              },
              {
                callId: 's2',
                name: 'agent_spawn',
                input: { agentType: 'general-purpose', intent: 'beta', brief: BRIEF_BETA },
              },
            ],
          },
          { text: SPAWN_TURN_TEXT },
        ],
        [`${ctx.sessionId}#${BRIEF_ALPHA}@host-a`]: [{ gateFile: alphaGo, text: ALPHA_TEXT }],
        [`${ctx.sessionId}#${BRIEF_BETA}@host-a`]: [
          {
            calls: [
              { callId: GATE_CALL, name: 'bash', input: { description: 'gated', command: gated } },
            ],
          },
          { text: BETA_TEXT },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitsForText({ ctx, what: 'the spawn turn to answer', text: SPAWN_TURN_TEXT })
    await waitUntil({
      what: 'both sub-agents to be recorded',
      check: async () => ofType(await parentEvents(ctx), 'agent-spawned').length === 2,
    })
    writeFileSync(alphaGo, 'go')
    await waitUntil({
      what: 'the first sub-agent to answer',
      check: async () => {
        const alpha = childIdOf(await parentEvents(ctx), 'alpha')
        const events = await threadEventsOf({ ctx, threadId: alpha })
        return saidOf(events, ALPHA_TEXT)
      },
    })
    await waitUntil({
      what: 'the second sub-agent to reach its gated call',
      check: async () => ctx.runCount('runs') === 1,
    })
    return hostA
  },

  async inFlight(ctx) {
    const events = await parentEvents(ctx)
    want({
      what: 'parent turn starts before the wake',
      got: ofType(events, 'turn-started').length,
      want: 1,
    })
    want({ what: 'gated runs', got: await ctx.runCount('runs'), want: 1 })
    const beta = childIdOf(events, 'beta')
    want({
      what: 'beta endings before the gate opens',
      got: ofType(events, 'agent-ended').filter((event) => event.agentId === beta).length,
      want: 0,
    })
    const betaEvents = await threadEventsOf({ ctx, threadId: beta })
    want({
      what: 'beta gated call dispatches',
      got: betaEvents.filter(
        (event) => event.type === 'tool-dispatched' && callOf(event) === GATE_CALL,
      ).length,
      want: 1,
    })
    const alpha = childIdOf(events, 'alpha')
    const recorded = ofType(events, 'agent-ended').find((event) => event.agentId === alpha)
    if (recorded !== undefined) expect(recorded.held).toBe(true)
  },

  async release(ctx) {
    await ctx.release('gate')
  },

  settled: settleAfterRelease,

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    await waitUntil({
      what: 'the restarted pod to report the gated call interrupted',
      check: async () => {
        const beta = childIdOf(await parentEvents(ctx), 'beta')
        const events = await threadEventsOf({ ctx, threadId: beta })
        return events.some(
          (event) =>
            event.type === 'tool-result' &&
            callOf(event) === GATE_CALL &&
            (event as { interrupted?: boolean }).interrupted === true,
        )
      },
      timeoutMs: 60_000,
    })
    await settleAfterRelease(ctx)
  },
})

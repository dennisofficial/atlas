import { expect } from 'bun:test'

import { EInputConsumed, type V2Event } from '@dltech/atlas-core'

import type { HostKnobs, HostProcess } from '../../testing/fault-rig'
import { describeHandoff, waitUntil, type HandoffContext } from '../../testing/handoff-suite'
import { EHostFault } from '../../testing/host-faults'
import { sleep, waitForLog } from './lease-fault-support'

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const PROMPT = `PANE-SAY-${RUN} spawn one sub-agent`
const INTENT = 'receiver'
const BRIEF = `PANE-BRIEF-${RUN} wait for a message`
const SAID = `PANE-SAID-${RUN} hello`
const SPAWNED_TEXT = 'waiting for a message'
const CHILD_IDLE = `PANE-CHILD-${RUN} waiting`
const CHILD_REPLY = `PANE-CHILD-${RUN} heard it`
const NOTED = 'noted'
const CHILD_HOLD_MS = 5_000

const KNOBS: HostKnobs = { plugins: true }

const parentEvents = async (ctx: HandoffContext): Promise<V2Event[]> =>
  (await ctx.record()).map((row) => row.event as V2Event)

const childEventsOf = async (args: {
  ctx: HandoffContext
  childId: string
}): Promise<readonly V2Event[]> => {
  const page = await args.ctx.rig.plane.readEvents({
    threadId: args.childId,
    afterSeq: 0,
    limit: 1_000,
    visible: false,
  })
  return [...page.events]
}

const ofType = <T extends V2Event['type']>(
  events: readonly V2Event[],
  type: T,
): Extract<V2Event, { type: T }>[] =>
  events.filter((event): event is Extract<V2Event, { type: T }> => event.type === type)

const childIdOf = async (ctx: HandoffContext): Promise<string> => {
  const spawn = ofType(await parentEvents(ctx), 'agent-spawned').find(
    (event) => event.intent === INTENT,
  )
  if (spawn === undefined) throw new Error('the record never carried the receiver sub-agent')
  return spawn.agentId
}

const saidEventsOf = async (ctx: HandoffContext): Promise<number> => {
  const childId = await childIdOf(ctx)
  const events = await childEventsOf({ ctx, childId })
  return events.filter(
    (row) => row.type === 'input-posted' && JSON.stringify(row.message ?? {}).includes(SAID),
  ).length
}

const repliesOf = async (ctx: HandoffContext): Promise<number> => {
  const childId = await childIdOf(ctx)
  const events = await childEventsOf({ ctx, childId })
  return events.filter(
    (row) => row.type === 'assistant-said' && JSON.stringify(row).includes(CHILD_REPLY),
  ).length
}

const outcomesOf = async (ctx: HandoffContext): Promise<V2Event[]> =>
  ofType(await parentEvents(ctx), 'command-applied')

const consumedCommandsOf = async (
  ctx: HandoffContext,
): Promise<Extract<V2Event, { type: 'input-consumed' }>[]> =>
  ofType(await parentEvents(ctx), 'input-consumed').filter(
    (event) => event.consumed === EInputConsumed.Command,
  )

const fail = (message: string): never => {
  throw new Error(message)
}

const expectOneDelivery = async (ctx: HandoffContext): Promise<void> => {
  const deliveries = await saidEventsOf(ctx)
  if (deliveries !== 1) fail(`the sub-agent received the message ${deliveries} times, wanted 1`)
  const consumed = await consumedCommandsOf(ctx)
  if (consumed.length !== 1) fail(`the command was consumed ${consumed.length} times, wanted 1`)
}

const expectOneOutcome = async (ctx: HandoffContext): Promise<void> => {
  await waitUntil({
    what: 'exactly one applied outcome for the pane command',
    timeoutMs: 60_000,
    check: async () => (await outcomesOf(ctx)).length === 1,
  })
  await sleep(2_000)
  const outcomes = await outcomesOf(ctx)
  const consumed = await consumedCommandsOf(ctx)
  expect(outcomes).toHaveLength(1)
  expect(outcomes[0]).toMatchObject({ inboxId: consumed[0]?.inboxId, name: 'agent' })
  await expectOneDelivery(ctx)
  const replies = await repliesOf(ctx)
  if (replies !== 1) fail(`the sub-agent answered the message ${replies} times, wanted 1`)
}

describeHandoff({
  name: 'a pane command acts once and records one outcome across a holder swap',
  prompt: PROMPT,
  knobs: KNOBS,

  takeOverScripts({ sessionId }) {
    return {
      [`${sessionId}#${SAID}@host-b`]: [{ text: CHILD_REPLY }, { text: NOTED }],
      [`${sessionId}#${PROMPT}@host-b`]: [{ text: NOTED }, { text: NOTED }, { text: NOTED }],
      [`${sessionId}#${BRIEF}@host-b`]: [{ text: CHILD_IDLE }, { text: NOTED }],
    }
  },

  async start(ctx): Promise<HostProcess> {
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      knobs: { ...KNOBS, fault: EHostFault.CommandOutcomeHangs },
      scripts: {
        [`${ctx.sessionId}#${SAID}@host-a`]: [{ text: CHILD_REPLY }, { text: NOTED }],
        [`${ctx.sessionId}#${PROMPT}@host-a`]: [
          {
            calls: [
              {
                callId: 'p1',
                name: 'agent_spawn',
                input: { agentType: 'general-purpose', intent: INTENT, brief: BRIEF },
              },
            ],
          },
          { text: SPAWNED_TEXT },
          { text: NOTED },
          { text: NOTED },
        ],
        [`${ctx.sessionId}#${BRIEF}@host-a`]: [
          { text: CHILD_IDLE, streamMs: CHILD_HOLD_MS },
          { text: NOTED },
        ],
      },
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitUntil({
      what: 'the receiver sub-agent to be recorded',
      timeoutMs: 60_000,
      check: async () => ofType(await parentEvents(ctx), 'agent-spawned').length === 1,
    })
    await ctx.rig.plane.post({
      sessionId: ctx.sessionId,
      kind: 'command:agent',
      payload: JSON.stringify({ action: 'say', agentId: await childIdOf(ctx), text: SAID }),
    })
    await ctx.rig.wake(ctx.sessionId)
    await waitForLog({ host: hostA, text: 'fault: command outcome hangs', timeoutMs: 60_000 })
    await waitUntil({
      what: 'the sub-agent to receive the message while its first turn still holds',
      timeoutMs: 60_000,
      check: async () => (await saidEventsOf(ctx)) === 1,
    })
    await expectOneDelivery(ctx)
    expect(await outcomesOf(ctx)).toHaveLength(0)
    return hostA
  },

  async inFlight(ctx) {
    await expectOneDelivery(ctx)
    expect((await outcomesOf(ctx)).length).toBeLessThanOrEqual(1)
  },

  async release() {},

  settled: expectOneOutcome,

  async runs(ctx) {
    return await saidEventsOf(ctx)
  },

  async interrupted(ctx) {
    await expectOneDelivery(ctx)
  },
})

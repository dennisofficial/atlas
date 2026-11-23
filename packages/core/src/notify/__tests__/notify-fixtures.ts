import { EAgentRestart } from '../../agents/restart'
import { EAgentStart } from '../../agents/start'
import { EAgentStatus } from '../../agents/status'
import { EMessageOrigin } from '../../events/body'
import { toCallId, toEventId, toRunId, toThreadId } from '../../events/ids'
import type { Hash, V2Body, V2Event } from '../../record/event'
import { ETurnCause, ETurnEndedBy, ETurnOutcome } from '../../record/turns'
import { EShellStatus } from '../../shells/status'
import { ESubscriptionActor, ESubscriptionStatus } from '../../subscriptions/subscription'

export const HOLD_SHELL_MS = 60 * 60 * 1000
export const HOLD_SUBSCRIPTION_MS = 10 * 60 * 1000

const threadId = toThreadId('thread-notify')
const runId = toRunId('run-notify')
const HASH = 'a'.repeat(64) as Hash
let sequence = 0

const eventOf = (body: V2Body): V2Event => {
  sequence += 1
  return {
    ...body,
    id: toEventId(`notify-${sequence}`),
    seq: sequence,
    threadId,
    runId,
    depth: 0,
    at: `2026-11-23T14:00:${String(sequence % 60).padStart(2, '0')}.000Z`,
    epoch: 1,
    prevHash: HASH,
  } as V2Event
}

export const turnStarted = (): V2Event =>
  eventOf({ type: 'turn-started', turnId: `turn-${sequence + 1}`, cause: ETurnCause.Input })

export const turnEnded = (): V2Event =>
  eventOf({
    type: 'turn-ended',
    turnId: `turn-${sequence}`,
    outcome: ETurnOutcome.Completed,
    by: ETurnEndedBy.Agent,
  })

export const operatorSaid = (via?: EMessageOrigin): V2Event =>
  eventOf({ type: 'user-said', text: 'go', ...(via === undefined ? {} : { via }) })

export const shellStarted = (args: { shellId: string; bootId?: string }): V2Event =>
  eventOf({
    type: 'background-shell-started',
    shellId: args.shellId,
    command: 'bun test',
    ...(args.bootId === undefined ? {} : { bootId: args.bootId }),
  })

export const shellEnded = (args: { shellId: string; bootId?: string }): V2Event =>
  eventOf({
    type: 'background-shell-ended',
    shellId: args.shellId,
    command: 'bun test',
    status: EShellStatus.Exited,
    exitCode: 0,
    output: '',
    droppedCharacters: 0,
    remainingCharacters: 0,
    ...(args.bootId === undefined ? {} : { bootId: args.bootId }),
  })

export const agentSpawned = (agentId: string): V2Event =>
  eventOf({
    type: 'agent-spawned',
    agentId: toThreadId(agentId),
    agentType: 'builder',
    intent: 'build the slice',
    mode: EAgentStart.Fresh,
  })

export const agentRestarted = (agentId: string): V2Event =>
  eventOf({
    type: 'agent-restarted',
    agentId: toThreadId(agentId),
    agentType: 'builder',
    intent: 'build the slice',
    via: EAgentRestart.Resume,
  })

export const agentEnded = (agentId: string): V2Event =>
  eventOf({
    type: 'agent-ended',
    agentId: toThreadId(agentId),
    agentType: 'builder',
    intent: 'build the slice',
    status: EAgentStatus.Finished,
    prose: 'done',
    turns: 1,
    toolCalls: 2,
  })

export const subscriptionCreated = (subscriptionId: string): V2Event =>
  eventOf({
    type: 'subscription-created',
    subscriptionId,
    provider: 'github',
    target: { kind: 'pull-request', number: 1 },
    label: 'CI',
    createdBy: ESubscriptionActor.Agent,
  })

export const subscriptionChanged = (args: {
  subscriptionId: string
  status: ESubscriptionStatus
}): V2Event =>
  eventOf({
    type: 'subscription-changed',
    subscriptionId: args.subscriptionId,
    status: args.status,
    by: ESubscriptionActor.Agent,
  })

export const serviceStarted = (serviceId: string): V2Event =>
  eventOf({ type: 'service-started', serviceId, command: 'bun run dev' })

export const parkedCall = (): V2Event =>
  eventOf({ type: 'tool-parked', callId: toCallId('call-1'), name: 'bash' })

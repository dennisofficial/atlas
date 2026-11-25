import { toAccountId } from '../../credentials/account'
import { toCallId, toEventId, toRunId, toThreadId } from '../../events/ids'
import { ERunFailureKind } from '../../events/run-failure'
import { EModelWaitCause, EWaitEpisodeKind } from '../../model-recovery/waiting'
import { EProviderFailureKind } from '../../models/provider-failure'
import { ERetryReason } from '../../models/retry'
import { EFinishReason } from '../../stream/chunk'
import { ESubscriptionActor, ESubscriptionEnd } from '../../subscriptions/subscription'
import { ECompactionAnchor } from '../../events/body'
import { EInputConsumed, type Hash, type RecordEvent } from '../event'
import { sessionStatusOf } from '../session-status'
import { ETurnCause, ETurnEndedBy, ETurnOutcome } from '../turns'

export const NOW = '2026-11-03T12:00:00.000Z'
export const STARTED_AT = '2026-11-03T11:59:50.000Z'
export const ENDED_AT = '2026-11-03T12:00:05.000Z'
const HASH = 'a'.repeat(64) as Hash
const THREAD = toThreadId('t')
const RUN = toRunId('r')
const CALL = toCallId('c1')

let seq = 0

const envelope = (
  at: string = NOW,
): Pick<
  RecordEvent,
  'id' | 'seq' | 'threadId' | 'runId' | 'depth' | 'at' | 'epoch' | 'prevHash'
> => {
  seq += 1
  return {
    id: toEventId(`t:${seq}`),
    seq,
    threadId: THREAD,
    runId: RUN,
    depth: 0,
    at,
    epoch: 1,
    prevHash: HASH,
  }
}

export const turnStarted = (args: { turnId?: string; at?: string } = {}): RecordEvent => ({
  ...envelope(args.at ?? STARTED_AT),
  type: 'turn-started',
  turnId: args.turnId ?? 'turn-1',
  cause: ETurnCause.Input,
})

export const turnEnded = (
  args: { turnId?: string; outcome?: ETurnOutcome; by?: ETurnEndedBy; at?: string } = {},
): RecordEvent => ({
  ...envelope(args.at ?? ENDED_AT),
  type: 'turn-ended',
  turnId: args.turnId ?? 'turn-1',
  outcome: args.outcome ?? ETurnOutcome.Completed,
  by: args.by ?? ETurnEndedBy.Agent,
})

export const userSaid = (at?: string): RecordEvent => ({
  ...envelope(at),
  type: 'user-said',
  text: 'hi',
})

export const assistantSaid = (
  args: { aborted?: 'handoff'; finish?: EFinishReason; at?: string } = {},
): RecordEvent => ({
  ...envelope(args.at),
  type: 'assistant-said',
  parts: [],
  aborted: args.aborted,
  finish: args.finish,
})

export const toolCalled = (at?: string): RecordEvent => ({
  ...envelope(at),
  type: 'tool-called',
  callId: CALL,
  name: 'bash',
  ordinal: 0,
})

export const toolDispatched = (args: { name?: string; at?: string } = {}): RecordEvent => ({
  ...envelope(args.at),
  type: 'tool-dispatched',
  callId: CALL,
  name: args.name ?? 'bash',
})

export const toolResult = (args: { interrupted?: boolean; at?: string } = {}): RecordEvent => ({
  ...envelope(args.at),
  type: 'tool-result',
  callId: CALL,
  name: 'bash',
  interrupted: args.interrupted,
})

export const toolDenied = (at?: string): RecordEvent => ({
  ...envelope(at),
  type: 'tool-denied',
  callId: CALL,
  name: 'bash',
  reason: 'no',
})

export const toolParked = (at?: string): RecordEvent => ({
  ...envelope(at),
  type: 'tool-parked',
  callId: CALL,
  name: 'bash',
})

export const branchesObserved = (): RecordEvent => ({
  ...envelope(),
  type: 'branches-observed',
  repo: '/work',
  head: 'main',
  branches: [],
  worktrees: [],
})

export const pullRequestLinked = (): RecordEvent => ({
  ...envelope(),
  type: 'pull-request-linked',
  number: 7,
  url: 'https://github.com/o/r/pull/7',
  repo: 'o/r',
  branch: 'topic',
})

export const subscriptionEnded = (): RecordEvent => ({
  ...envelope(),
  type: 'subscription-ended',
  subscriptionId: 'sub_1',
  reason: ESubscriptionEnd.Completed,
  by: ESubscriptionActor.Provider,
})

export const contextLoaded = (): RecordEvent => ({
  ...envelope(),
  type: 'context-loaded',
  slot: 'repo',
  key: 'k',
  content: 'loaded',
})

export const worktreeEntered = (): RecordEvent => ({
  ...envelope(),
  type: 'worktree-entered',
  path: '/work/wt',
  branch: 'topic',
})

export const otherFact = (): RecordEvent => ({
  ...envelope(),
  type: 'fact-recorded',
  key: 'note',
  kind: 'note',
})

export const unknownFact = (): RecordEvent =>
  ({ ...envelope(), type: 'bookkeeping-from-a-newer-client' }) as unknown as RecordEvent

export const inputConsumed = (consumed: EInputConsumed = EInputConsumed.Stop): RecordEvent => ({
  ...envelope(),
  type: 'input-consumed',
  inboxId: 7,
  consumed,
})

export const commandPosted = (args: { inboxId?: number; name?: string } = {}): RecordEvent => ({
  ...envelope(STARTED_AT),
  type: 'input-posted',
  inboxId: args.inboxId ?? 7,
  kind: `command:${args.name ?? 'summarise'}`,
  postedAt: STARTED_AT,
})

export const commandConsumed = (args: { inboxId?: number; name?: string } = {}): RecordEvent => ({
  ...envelope(),
  type: 'input-consumed',
  inboxId: args.inboxId ?? 7,
  consumed: EInputConsumed.Command,
  ...(args.name === undefined
    ? {}
    : { command: { name: args.name, argumentText: '', text: args.name } }),
})

export const summarised = (args: { inboxId?: number } = {}): RecordEvent => ({
  ...envelope(),
  type: 'history-summarised',
  fromSeq: 1,
  throughSeq: 1,
  anchor: ECompactionAnchor.Prefix,
  summary: 's',
  inboxId: args.inboxId ?? 7,
})

export const commandRefused = (args: { inboxId?: number } = {}): RecordEvent => ({
  ...envelope(),
  type: 'input-refused',
  inboxId: args.inboxId ?? 7,
  reason: 'no',
})

export const runFailed = (
  args: { message?: string; kind?: ERunFailureKind } = {},
): RecordEvent => ({
  ...envelope(),
  type: 'run-failed',
  failure: {
    kind: args.kind ?? ERunFailureKind.Network,
    message: args.message ?? 'connection reset',
  },
})

export const dismissFailure = (failure: RecordEvent): RecordEvent => ({
  ...envelope(),
  type: 'run-failure-dismissed',
  failureSeq: failure.seq,
})

export const retry = (args: { notBefore: string }): RecordEvent => ({
  ...envelope(),
  type: 'retry-scheduled',
  key: 'retry:t:s0:1',
  notBefore: args.notBefore,
  attempt: 1,
  reason: ERetryReason.Network,
})

export const retryLikeFact = (args: { notBefore: string }): RecordEvent => ({
  ...envelope(),
  type: 'fact-recorded',
  key: 'retry:model',
  kind: 'retry',
  value: { notBefore: args.notBefore },
})

export const modelWaiting = (args: { reason?: string } = {}): RecordEvent => ({
  ...envelope(),
  type: 'model-waiting',
  waiting: {
    episode: {
      kind: EWaitEpisodeKind.Credential,
      key: { accountId: toAccountId('a'), providerId: 'openai', modelId: 'gpt-5' },
      generation: 1,
    },
    cause: EModelWaitCause.Availability,
    providerId: 'openai',
    accountId: 'a',
    modelId: null,
    reason: args.reason === undefined ? null : (args.reason as EProviderFailureKind),
    resetAt: null,
    affectedThreadIds: [THREAD],
  },
})

export const waitCleared = (
  waiting: Extract<RecordEvent, { type: 'model-waiting' }>,
): RecordEvent => ({
  ...envelope(),
  type: 'model-wait-cleared',
  episode: waiting.waiting.episode,
  cause: waiting.waiting.cause,
})

export const statusOf = (args: {
  events?: readonly RecordEvent[]
  live?: boolean
  queuedSince?: string | null
  messageAfterFailure?: boolean
  now?: string
}) =>
  sessionStatusOf({
    events: args.events ?? [],
    live: args.live ?? false,
    queuedSince: args.queuedSince ?? null,
    messageAfterFailure: args.messageAfterFailure,
    now: args.now ?? NOW,
  })

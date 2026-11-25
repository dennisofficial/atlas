import { EAgentRestart } from '../../agents/restart'
import { EAgentStart } from '../../agents/start'
import { EAgentStatus } from '../../agents/status'
import { toAccountId } from '../../credentials/account'
import { toEventId, toRunId, toThreadId, type ThreadId } from '../../events/ids'
import { ERunFailureKind, type RunFailure } from '../../events/run-failure'
import {
  EModelWaitCause,
  EWaitEpisodeKind,
  type WaitEpisodeRef,
  type WaitingForModel,
} from '../../model-recovery/waiting'
import { EProviderFailureKind } from '../../models/provider-failure'
import type { Hash, RecordEnvelope, RecordEvent } from '../../record/event'
import { ETurnCause } from '../../record/turns'

export const MAIN = toThreadId('main')
export const CHILD = toThreadId('child')
const HASH = 'a'.repeat(64) as Hash
const RUN = toRunId('r1')

let seq = 0
const envelopeOf = (threadId: ThreadId): RecordEnvelope => {
  seq += 1
  return {
    id: toEventId(`e${seq}`),
    seq,
    threadId,
    runId: RUN,
    depth: 0,
    at: `2026-11-20T00:00:${String(seq).padStart(2, '0')}.000Z`,
    epoch: 1,
    prevHash: HASH,
  }
}

export const failureOf = (overrides: Partial<RunFailure> = {}): RunFailure => ({
  kind: ERunFailureKind.Auth,
  message: 'invalid x-api-key',
  providerId: 'anthropic',
  accountId: 'a1',
  ...overrides,
})

export const runFailed = (failure: RunFailure, threadId: ThreadId = MAIN): RecordEvent => ({
  ...envelopeOf(threadId),
  type: 'run-failed',
  failure,
})

export const dismissed = (failureSeq: number, threadId: ThreadId = MAIN): RecordEvent => ({
  ...envelopeOf(threadId),
  type: 'run-failure-dismissed',
  failureSeq,
})

export const userSaid = (threadId: ThreadId = MAIN): RecordEvent => ({
  ...envelopeOf(threadId),
  type: 'user-said',
  text: 'carry on',
})

export const turnStarted = (threadId: ThreadId = MAIN): RecordEvent => ({
  ...envelopeOf(threadId),
  type: 'turn-started',
  turnId: 'turn-1',
  cause: ETurnCause.Input,
})

export const agentSpawned = (
  args: { agentId?: ThreadId; agentType?: string; intent?: string; threadId?: ThreadId } = {},
): RecordEvent => ({
  ...envelopeOf(args.threadId ?? MAIN),
  type: 'agent-spawned',
  agentId: args.agentId ?? CHILD,
  agentType: args.agentType ?? 'explore',
  intent: args.intent ?? 'audit the settings registry',
  mode: EAgentStart.Fresh,
})

export const agentEnded = (
  args: {
    status?: EAgentStatus
    failure?: RunFailure
    failureCause?: string
    agentId?: ThreadId
    agentType?: string
    intent?: string
    threadId?: ThreadId
  } = {},
): RecordEvent => ({
  ...envelopeOf(args.threadId ?? MAIN),
  type: 'agent-ended',
  agentId: args.agentId ?? CHILD,
  agentType: args.agentType ?? 'explore',
  intent: args.intent ?? 'audit the settings registry',
  status: args.status ?? EAgentStatus.Failed,
  prose: '',
  turns: 1,
  toolCalls: 2,
  ...(args.failure === undefined ? {} : { failure: args.failure }),
  ...(args.failureCause === undefined ? {} : { failureCause: args.failureCause }),
})

export const agentRestarted = (agentId: ThreadId = CHILD): RecordEvent => ({
  ...envelopeOf(MAIN),
  type: 'agent-restarted',
  agentId,
  agentType: 'explore',
  intent: 'audit the settings registry',
  via: EAgentRestart.Resume,
})

export const credentialEpisode = (
  args: { accountId?: string; providerId?: string; modelId?: string; generation?: number } = {},
): WaitEpisodeRef => ({
  kind: EWaitEpisodeKind.Credential,
  key: {
    accountId: toAccountId(args.accountId ?? 'a1'),
    providerId: args.providerId ?? 'anthropic',
    modelId: args.modelId ?? 'claude-sonnet',
  },
  generation: args.generation ?? 1,
})

export const credentialWait = (
  args: {
    episode?: WaitEpisodeRef
    reason?: EProviderFailureKind | null
    resetAt?: string | null
    affectedThreadIds?: readonly ThreadId[]
    modelId?: string | null
  } = {},
): WaitingForModel => {
  const episode = args.episode ?? credentialEpisode()
  return {
    episode,
    cause: EModelWaitCause.Availability,
    providerId: episode.kind === EWaitEpisodeKind.Credential ? episode.key.providerId : 'anthropic',
    accountId: episode.kind === EWaitEpisodeKind.Credential ? episode.key.accountId : null,
    modelId: args.modelId ?? null,
    reason: args.reason === undefined ? EProviderFailureKind.Auth : args.reason,
    resetAt: args.resetAt ?? null,
    affectedThreadIds: args.affectedThreadIds ?? [MAIN],
  }
}

export const modelWaiting = (waiting: WaitingForModel, threadId: ThreadId = MAIN): RecordEvent => ({
  ...envelopeOf(threadId),
  type: 'model-waiting',
  waiting,
})

export const modelWaitCleared = (
  episode: WaitEpisodeRef,
  threadId: ThreadId = MAIN,
): RecordEvent => ({
  ...envelopeOf(threadId),
  type: 'model-wait-cleared',
  episode,
  cause: EModelWaitCause.Availability,
})

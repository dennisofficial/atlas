import { EAgentStatus } from '../agents/status'
import { EAuthKind } from '../credentials/account'
import type { ThreadId } from '../events/ids'
import {
  ERunFailureKind,
  runFailureKindOfProviderKind,
  type RunFailureAgent,
} from '../events/run-failure'
import type { EProviderFailureKind } from '../models/provider-failure'
import { EWaitEpisodeKind } from '../model-recovery/waiting'
import { projectWaiting, waitEpisodeGroupKey } from '../model-recovery/waiting-projector'
import type { RecordEvent } from '../record/event'

export enum ERepairSource {
  Failure = 'failure',
  Waiting = 'waiting',
}

export enum ERepairAction {
  ReSignIn = 're-sign-in',
  ReplaceKey = 'replace-key',
  SwapAccount = 'swap-account',
  SwapModel = 'swap-model',
  CheckAgain = 'check-again',
}

export type CredentialRepair = {
  source: ERepairSource
  providerId: string | null
  modelId: string | null
  accountId: string | null
  kind: ERunFailureKind
  reason: EProviderFailureKind | null
  resetAt: string | null
  since: string
  seq: number
  main: boolean
  agents: readonly RunFailureAgent[]
}

export const REPAIRABLE_FAILURE_KINDS: ReadonlySet<ERunFailureKind> = new Set([
  ERunFailureKind.Auth,
  ERunFailureKind.Quota,
  ERunFailureKind.MissingCredential,
  ERunFailureKind.Delivery,
])

const SIGN_IN_REPAIRABLE: ReadonlySet<ERunFailureKind> = new Set([
  ERunFailureKind.Auth,
  ERunFailureKind.Delivery,
])

const KEY_REPAIRABLE: ReadonlySet<ERunFailureKind> = new Set([
  ERunFailureKind.Auth,
  ERunFailureKind.MissingCredential,
  ERunFailureKind.Delivery,
])

const MODEL_SWAPPABLE: ReadonlySet<ERunFailureKind> = new Set([
  ERunFailureKind.Auth,
  ERunFailureKind.Quota,
  ERunFailureKind.MissingCredential,
])

type OpenStop = {
  seq: number
  at: string
  source: ERepairSource
  providerId: string | null
  accountId: string | null
  modelId: string | null
  kind: ERunFailureKind
  reason: EProviderFailureKind | null
  resetAt: string | null
  main: boolean
  agent: RunFailureAgent | null
}

type WaitingEvent = Extract<RecordEvent, { type: 'model-waiting' | 'model-wait-cleared' }>

const isWaitingEvent = (event: RecordEvent): event is WaitingEvent =>
  event.type === 'model-waiting' || event.type === 'model-wait-cleared'

const agentOfEnding = (event: Extract<RecordEvent, { type: 'agent-ended' }>): RunFailureAgent => ({
  agentId: event.agentId,
  agentType: event.agentType,
  intent: event.intent,
})

const stopOfFailure = (event: Extract<RecordEvent, { type: 'run-failed' }>): OpenStop | null => {
  if (!REPAIRABLE_FAILURE_KINDS.has(event.failure.kind)) return null
  return {
    seq: event.seq,
    at: event.at,
    source: ERepairSource.Failure,
    providerId: event.failure.providerId ?? null,
    accountId: event.failure.accountId ?? null,
    modelId: event.failure.modelId ?? null,
    kind: event.failure.kind,
    reason: null,
    resetAt: event.failure.resetAt ?? null,
    main: true,
    agent: null,
  }
}

const stopOfEnding = (event: Extract<RecordEvent, { type: 'agent-ended' }>): OpenStop | null => {
  const failure = event.failure
  if (event.status !== EAgentStatus.Failed || failure === undefined) return null
  if (!REPAIRABLE_FAILURE_KINDS.has(failure.kind)) return null
  return {
    seq: event.seq,
    at: event.at,
    source: ERepairSource.Failure,
    providerId: failure.providerId ?? null,
    accountId: failure.accountId ?? null,
    modelId: failure.modelId ?? null,
    kind: failure.kind,
    reason: null,
    resetAt: failure.resetAt ?? null,
    main: false,
    agent: agentOfEnding(event),
  }
}

const dismisses = ({ stop, failureSeq }: { stop: OpenStop; failureSeq: number }): boolean =>
  stop.seq === failureSeq

function failureStopsOf({
  mainThreadId,
  events,
}: {
  mainThreadId: ThreadId
  events: readonly RecordEvent[]
}): readonly OpenStop[] {
  const openMain = new Map<number, OpenStop>()
  const openChild = new Map<string, OpenStop>()
  for (const event of events) {
    switch (event.type) {
      case 'run-failed': {
        const stop = stopOfFailure(event)
        if (stop !== null && event.threadId === mainThreadId) openMain.set(stop.seq, stop)
        break
      }
      case 'run-failure-dismissed': {
        for (const [seq, stop] of openMain) {
          if (dismisses({ stop, failureSeq: event.failureSeq })) openMain.delete(seq)
        }
        for (const [agentId, stop] of openChild) {
          if (dismisses({ stop, failureSeq: event.failureSeq })) openChild.delete(agentId)
        }
        break
      }
      case 'turn-started': {
        if (event.threadId === mainThreadId) openMain.clear()
        break
      }
      case 'user-said': {
        openChild.clear()
        if (event.threadId === mainThreadId) openMain.clear()
        break
      }
      case 'agent-ended': {
        openChild.delete(event.agentId)
        const stop = stopOfEnding(event)
        if (stop !== null) openChild.set(event.agentId, stop)
        break
      }
      case 'agent-restarted': {
        openChild.delete(event.agentId)
        break
      }
      default:
        break
    }
  }
  return [...openMain.values(), ...openChild.values()]
}

const spawnedAgentsOf = (events: readonly RecordEvent[]): ReadonlyMap<string, RunFailureAgent> => {
  const spawned = new Map<string, RunFailureAgent>()
  for (const event of events) {
    if (event.type === 'agent-spawned') {
      spawned.set(event.agentId, {
        agentId: event.agentId,
        agentType: event.agentType,
        intent: event.intent,
      })
    }
  }
  return spawned
}

const agentOfThread = ({
  spawned,
  threadId,
}: {
  spawned: ReadonlyMap<string, RunFailureAgent>
  threadId: ThreadId
}): RunFailureAgent => spawned.get(threadId) ?? { agentId: threadId, agentType: '', intent: '' }

const latestWaitEventsOf = (
  events: readonly RecordEvent[],
): ReadonlyMap<string, Extract<RecordEvent, { type: 'model-waiting' }>> => {
  const latest = new Map<string, Extract<RecordEvent, { type: 'model-waiting' }>>()
  for (const event of events) {
    if (event.type === 'model-waiting') {
      latest.set(waitEpisodeGroupKey(event.waiting.episode), event)
    }
  }
  return latest
}

function waitStopsOf({
  mainThreadId,
  events,
}: {
  mainThreadId: ThreadId
  events: readonly RecordEvent[]
}): readonly OpenStop[] {
  const spawned = spawnedAgentsOf(events)
  const latest = latestWaitEventsOf(events)
  return projectWaiting(events.filter(isWaitingEvent)).flatMap((waiting) => {
    if (waiting.episode.kind !== EWaitEpisodeKind.Credential) return []
    const opening = latest.get(waitEpisodeGroupKey(waiting.episode))
    if (opening === undefined) return []
    return waiting.affectedThreadIds.map((threadId) => ({
      seq: opening.seq,
      at: opening.at,
      source: ERepairSource.Waiting,
      providerId: waiting.providerId,
      accountId: waiting.accountId,
      modelId: waiting.modelId,
      kind:
        waiting.reason === null
          ? ERunFailureKind.Other
          : runFailureKindOfProviderKind(waiting.reason),
      reason: waiting.reason,
      resetAt: waiting.resetAt,
      main: threadId === mainThreadId,
      agent: threadId === mainThreadId ? null : agentOfThread({ spawned, threadId }),
    }))
  })
}

const groupKeyOf = (stop: OpenStop): string => JSON.stringify([stop.providerId, stop.accountId])

const agentsOfGroup = (group: readonly OpenStop[]): readonly RunFailureAgent[] => {
  const agents = new Map<string, RunFailureAgent>()
  for (const stop of group) {
    if (stop.agent !== null && !agents.has(stop.agent.agentId)) {
      agents.set(stop.agent.agentId, stop.agent)
    }
  }
  return [...agents.values()]
}

export function credentialRepairOf(args: {
  mainThreadId: ThreadId
  events: readonly RecordEvent[]
}): CredentialRepair | null {
  const stops = [...failureStopsOf(args), ...waitStopsOf(args)].sort((a, b) => a.seq - b.seq)
  const newest = stops.at(-1)
  if (newest === undefined) return null
  const key = groupKeyOf(newest)
  const group = stops.filter((stop) => groupKeyOf(stop) === key)
  return {
    source: newest.source,
    providerId: newest.providerId,
    modelId: newest.modelId,
    accountId: newest.accountId,
    kind: newest.kind,
    reason: newest.reason,
    resetAt: newest.resetAt,
    since: newest.at,
    seq: newest.seq,
    main: group.some((stop) => stop.main),
    agents: agentsOfGroup(group),
  }
}

export function repairActionsOf(args: {
  repair: CredentialRepair
  accountKind: EAuthKind | null
  otherAccountsOfProvider: number
}): readonly ERepairAction[] {
  const { repair } = args
  const actions: ERepairAction[] = []
  if (args.accountKind === EAuthKind.Oauth && SIGN_IN_REPAIRABLE.has(repair.kind)) {
    actions.push(ERepairAction.ReSignIn)
  }
  if (args.accountKind === EAuthKind.ApiKey && KEY_REPAIRABLE.has(repair.kind)) {
    actions.push(ERepairAction.ReplaceKey)
  }
  if (args.otherAccountsOfProvider > 0) actions.push(ERepairAction.SwapAccount)
  if (repair.main && MODEL_SWAPPABLE.has(repair.kind)) actions.push(ERepairAction.SwapModel)
  if (repair.resetAt !== null) actions.push(ERepairAction.CheckAgain)
  return actions
}

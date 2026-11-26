import { shellKey } from '../shells/lifecycle'
import type { RecordEvent } from './event'

export enum EOpenFamily {
  Turn = 'turn',
  Call = 'call',
  Approval = 'approval',
  OperatorInput = 'operator-input',
  Shell = 'shell',
  Service = 'service',
  Subscription = 'subscription',
  Failure = 'failure',
  Refusal = 'refusal',
}

export type OpenGroup = { family: EOpenFamily; key: string }

const groupOf = (event: RecordEvent): OpenGroup | undefined => {
  switch (event.type) {
    case 'turn-started':
    case 'turn-ended':
      return { family: EOpenFamily.Turn, key: event.turnId }
    case 'tool-called':
    case 'tool-dispatched':
    case 'tool-parked':
    case 'tool-result':
    case 'tool-denied':
      return { family: EOpenFamily.Call, key: event.callId }
    case 'approval-requested':
    case 'approval-answered':
      return { family: EOpenFamily.Approval, key: event.callId }
    case 'operator-input-requested':
    case 'operator-input-resolved':
      return { family: EOpenFamily.OperatorInput, key: event.requestId }
    case 'background-shell-started':
    case 'background-shell-ended':
      return { family: EOpenFamily.Shell, key: shellKey(event) }
    case 'service-started':
    case 'service-ended':
      return { family: EOpenFamily.Service, key: `${event.bootId ?? ''}${event.serviceId}` }
    case 'subscription-created':
    case 'subscription-changed':
    case 'subscription-ended':
      return { family: EOpenFamily.Subscription, key: event.subscriptionId }
    case 'run-failed':
      return { family: EOpenFamily.Failure, key: String(event.seq) }
    case 'run-failure-dismissed':
      return { family: EOpenFamily.Failure, key: String(event.failureSeq) }
    case 'input-refused':
      return { family: EOpenFamily.Refusal, key: String(event.inboxId) }
    default:
      return undefined
  }
}

const CLOSING_TYPES: ReadonlySet<string> = new Set([
  'turn-ended',
  'tool-result',
  'tool-denied',
  'approval-answered',
  'operator-input-resolved',
  'background-shell-ended',
  'service-ended',
  'subscription-ended',
  'run-failure-dismissed',
])

export const SUPERSEDED_BY: Readonly<Record<'run-failed' | 'input-refused', readonly string[]>> = {
  'run-failed': ['user-said', 'assistant-said'],
  'input-refused': ['user-said', 'assistant-said', 'nudge'],
}

const SUPERSEDERS: ReadonlyMap<EOpenFamily, ReadonlySet<string>> = new Map([
  [EOpenFamily.Failure, new Set(SUPERSEDED_BY['run-failed'])],
  [EOpenFamily.Refusal, new Set(SUPERSEDED_BY['input-refused'])],
])

const groupKeyOf = (group: OpenGroup): string => `${group.family}\u0000${group.key}`

type GroupState = { family: EOpenFamily; openAt: number; closeAt: number | undefined }

export const groupStatesOf = (events: readonly RecordEvent[]): Map<string, GroupState> => {
  const states = new Map<string, GroupState>()
  for (const event of events) {
    const group = groupOf(event)
    if (group !== undefined) {
      const key = groupKeyOf(group)
      const held = states.get(key)
      const openAt = held?.openAt ?? event.seq
      const closeAt = CLOSING_TYPES.has(event.type)
        ? Math.max(held?.closeAt ?? 0, event.seq)
        : held?.closeAt
      states.set(key, { family: group.family, openAt, closeAt })
    }
    for (const [family, types] of SUPERSEDERS) {
      if (!types.has(event.type)) continue
      for (const [key, state] of states) {
        if (state.family !== family || state.closeAt !== undefined || state.openAt >= event.seq) {
          continue
        }
        states.set(key, { ...state, closeAt: event.seq })
      }
    }
  }
  return states
}

export const keptGroupsOf = (states: ReadonlyMap<string, GroupState>): ReadonlySet<string> => {
  const kept = new Set<string>()
  let newestClosedTurn: { key: string; openAt: number } | undefined
  for (const [key, state] of states) {
    if (state.closeAt === undefined) {
      kept.add(key)
      continue
    }
    if (state.family !== EOpenFamily.Turn) continue
    if (newestClosedTurn === undefined || state.openAt > newestClosedTurn.openAt) {
      newestClosedTurn = { key, openAt: state.openAt }
    }
  }
  if (newestClosedTurn !== undefined) kept.add(newestClosedTurn.key)
  return kept
}

export const isOpenGroupOf = (args: { event: RecordEvent; open: ReadonlySet<string> }): boolean => {
  const group = groupOf(args.event)
  return group !== undefined && args.open.has(groupKeyOf(group))
}

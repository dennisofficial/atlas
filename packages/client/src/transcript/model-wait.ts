import {
  EAvailabilityControlResult,
  EModelWaitCause,
  EProviderFailureKind,
  EWaitEpisodeKind,
  projectWaiting,
  providerLabelOf,
  waitEpisodeGroupKey,
  type Event,
  type ThreadId,
  type WaitingForModel,
} from '@dltech/atlas-core'

export enum EModelWaitAction {
  Recheck = 'recheck',
  RemoveManualPause = 'remove-manual-pause',
  Providers = 'providers',
}

export type ModelWaitActionSpec = {
  action: EModelWaitAction
  label: string
  primary: boolean
}

export type ModelWaitIssue = {
  key: string
  waiting: WaitingForModel
  paused: boolean
  detail: string
  lastCheckedAt: string | null
  affectedThreadIds: readonly ThreadId[]
  affectedLabel: string
  actions: readonly ModelWaitActionSpec[]
}

export type ModelWaitView = {
  title: string
  issues: readonly ModelWaitIssue[]
  partial: boolean
}

export const MODEL_WAIT_TITLE = 'Waiting for model'
export const MODEL_WAIT_PARTIAL_NOTE =
  'Another model may also be waiting; open the session to see every cause.'
export const NO_SESSIONS_WAITING = 'No sessions currently waiting'
export const RECHECK_CHARGE_WARNING =
  'Rechecking sends one normal model request, which may incur normal model charges.'
export const OLD_SERVE_CONTROLS = 'Update/restart this session to manage model access'

const UNKNOWN_REASON = 'model access unavailable'
const PAUSED_REASON = 'paused by you'
const RESET_NOT_SUPPLIED = 'Provider reset: not supplied.'

const REASON_TEXT: Readonly<Record<EProviderFailureKind, string>> = {
  [EProviderFailureKind.Auth]: 'the provider rejected this login',
  [EProviderFailureKind.Quota]: 'allowance exhausted',
  [EProviderFailureKind.RateLimited]: 'rate limited',
  [EProviderFailureKind.Network]: 'provider unreachable',
  [EProviderFailureKind.Overloaded]: 'provider overloaded',
  [EProviderFailureKind.Stalled]: 'provider stalled',
  [EProviderFailureKind.Delivery]: 'delivery fault',
  [EProviderFailureKind.ModelDenied]: 'model not permitted for this account',
  [EProviderFailureKind.ContextOverflow]: UNKNOWN_REASON,
  [EProviderFailureKind.InvalidRequest]: UNKNOWN_REASON,
  [EProviderFailureKind.Cancelled]: UNKNOWN_REASON,
  [EProviderFailureKind.Other]: UNKNOWN_REASON,
}

export const isManualPause = (waiting: WaitingForModel): boolean =>
  waiting.cause === EModelWaitCause.Availability && waiting.reason === null

export const resetLabelOf = (resetAt: string | null): string => {
  if (resetAt === null) return RESET_NOT_SUPPLIED
  const parsed = Date.parse(resetAt)
  if (Number.isNaN(parsed)) return RESET_NOT_SUPPLIED
  return `Provider reset: ${new Date(parsed).toISOString().slice(0, 16).replace('T', ' ')} UTC.`
}

export const lastCheckedLabelOf = (checkedAt: string | null): string => {
  const parsed = checkedAt === null ? Number.NaN : Date.parse(checkedAt)
  if (Number.isNaN(parsed)) return 'Last checked: not yet'
  return `Last checked ${new Date(parsed).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export const affectedLabelOf = (count: number): string => {
  if (count === 0) return NO_SESSIONS_WAITING
  return count === 1 ? '1 session waiting' : `${count} sessions waiting`
}

const prefixOf = (args: { waiting: WaitingForModel; accountLabel: string | undefined }): string => {
  const provider = providerLabelOf(args.waiting.providerId) ?? args.waiting.providerId
  return args.accountLabel === undefined ? provider : `${provider} · ${args.accountLabel}`
}

export function modelWaitDetailOf(args: {
  waiting: WaitingForModel
  accountLabel?: string | undefined
}): string {
  const { waiting } = args
  if (waiting.episode.kind === EWaitEpisodeKind.ControlPlane) {
    return `Atlas could not reach model access (${waiting.episode.code}). Check your connection or configuration.`
  }
  const prefix = prefixOf({ waiting, accountLabel: args.accountLabel })
  if (isManualPause(waiting)) return `${prefix}: ${PAUSED_REASON}. Remove the pause to continue.`
  const reason = waiting.reason === null ? UNKNOWN_REASON : REASON_TEXT[waiting.reason]
  return `${prefix}: ${reason}. ${resetLabelOf(waiting.resetAt)}`
}

export function modelWaitActionsOf(waiting: WaitingForModel): readonly ModelWaitActionSpec[] {
  const providers = { action: EModelWaitAction.Providers, label: 'Providers' }
  if (waiting.episode.kind === EWaitEpisodeKind.ControlPlane) {
    return [{ ...providers, primary: true }]
  }
  const first = isManualPause(waiting)
    ? { action: EModelWaitAction.RemoveManualPause, label: 'Remove manual pause' }
    : { action: EModelWaitAction.Recheck, label: 'Recheck access' }
  return [
    { ...first, primary: true },
    { ...providers, primary: false },
  ]
}

const lastCheckedOf = (args: { events: readonly Event[]; key: string }): string | null => {
  const seen = args.events.findLast(
    (event) =>
      event.type === 'model-waiting' && waitEpisodeGroupKey(event.waiting.episode) === args.key,
  )
  return seen?.at ?? null
}

export function modelWaitIssueOf(args: {
  waiting: WaitingForModel
  events: readonly Event[]
  accountLabelOf?: ((accountId: string) => string | undefined) | undefined
}): ModelWaitIssue {
  const { waiting } = args
  const key = waitEpisodeGroupKey(waiting.episode)
  const accountLabel =
    waiting.accountId === null ? undefined : args.accountLabelOf?.(waiting.accountId)
  return {
    key,
    waiting,
    paused: isManualPause(waiting),
    detail: modelWaitDetailOf({ waiting, accountLabel }),
    lastCheckedAt: lastCheckedOf({ events: args.events, key }),
    affectedThreadIds: waiting.affectedThreadIds,
    affectedLabel: affectedLabelOf(waiting.affectedThreadIds.length),
    actions: modelWaitActionsOf(waiting),
  }
}

const liveSnapshotOf = (args: {
  events: readonly Event[]
  snapshot: WaitingForModel | null | undefined
}): WaitingForModel | null => {
  const { snapshot } = args
  if (snapshot === null || snapshot === undefined) return null
  const key = waitEpisodeGroupKey(snapshot.episode)
  const cleared = args.events.some(
    (event) => event.type === 'model-wait-cleared' && waitEpisodeGroupKey(event.episode) === key,
  )
  return cleared ? null : snapshot
}

export function modelWaitViewOf(args: {
  events: readonly Event[]
  live?: readonly WaitingForModel[] | null | undefined
  snapshot?: WaitingForModel | null | undefined
  accountLabelOf?: ((accountId: string) => string | undefined) | undefined
}): ModelWaitView | null {
  const projected = projectWaiting(args.events)
  const snapshot = liveSnapshotOf({ events: args.events, snapshot: args.snapshot })
  const authoritative = args.live ?? null
  const partial = authoritative === null && projected.length === 0 && snapshot !== null
  const waits = authoritative ?? (partial && snapshot !== null ? [snapshot] : projected)
  if (waits.length === 0) return null
  return {
    title: MODEL_WAIT_TITLE,
    partial,
    issues: waits.map((waiting) =>
      modelWaitIssueOf({
        waiting,
        events: args.events,
        accountLabelOf: args.accountLabelOf,
      }),
    ),
  }
}

export const modelWaitAnnouncementOf = (view: ModelWaitView): string =>
  `${view.title}: ${view.issues.map((issue) => issue.detail).join(' ')}`

export enum EControlOutcomeTone {
  Done = 'done',
  Info = 'info',
  Retry = 'retry',
  Error = 'error',
}

export type ControlOutcomeNote = { tone: EControlOutcomeTone; text: string }

const OUTCOME_NOTES: Readonly<Record<EAvailabilityControlResult, ControlOutcomeNote>> = {
  [EAvailabilityControlResult.Applied]: {
    tone: EControlOutcomeTone.Done,
    text: 'Applied. Atlas will continue if the provider accepts the next request.',
  },
  [EAvailabilityControlResult.Available]: {
    tone: EControlOutcomeTone.Done,
    text: 'Access is available. Waiting sessions are continuing.',
  },
  [EAvailabilityControlResult.Unavailable]: {
    tone: EControlOutcomeTone.Info,
    text: 'Still unavailable. Atlas kept the sessions waiting.',
  },
  [EAvailabilityControlResult.ProbeInProgress]: {
    tone: EControlOutcomeTone.Info,
    text: 'A check is already running. Try again in a moment.',
  },
  [EAvailabilityControlResult.Stale]: {
    tone: EControlOutcomeTone.Retry,
    text: 'This account changed since the page loaded. Reloaded. Try again.',
  },
  [EAvailabilityControlResult.Unreachable]: {
    tone: EControlOutcomeTone.Error,
    text: 'Could not reach the provider. The previous state is kept.',
  },
}

export const controlOutcomeNoteOf = (result: EAvailabilityControlResult): ControlOutcomeNote =>
  OUTCOME_NOTES[result]

export const controlFailureNoteOf = (failure: unknown): ControlOutcomeNote => ({
  tone: EControlOutcomeTone.Error,
  text: failure instanceof Error ? failure.message : 'The request failed. Nothing changed.',
})

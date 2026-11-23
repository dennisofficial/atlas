import type {
  ReleasePullRequestTrackingParams,
  SubscriptionDraft,
  SubscriptionKey,
  SubscriptionRow,
  WrittenSubscriptionRow,
} from '../../port'
import { repoFullNameOf } from '../../repo-name'
import { trackingTargetKey, type State } from './memory-state'

const subscriptionKeyOf = (key: SubscriptionKey): string =>
  `${key.userId} ${key.repoFullName} ${key.branch} ${key.threadId}`

export const findSubscriptionIn = (params: {
  state: State
  key: SubscriptionKey
}): SubscriptionRow | undefined => {
  const wanted = subscriptionKeyOf(params.key)
  return [...params.state.subscriptions.values()].find((row) => subscriptionKeyOf(row) === wanted)
}

export const readSubscriptionIn = (params: {
  state: State
  subscriptionId: string
}): SubscriptionRow | undefined => {
  const row = params.state.subscriptions.get(params.subscriptionId)
  return row === undefined ? undefined : { ...row, events: [...row.events] }
}

export const threadIdsOfSessionIn = (params: { state: State; sessionId: string }): string[] => {
  const session = params.state.sessions.get(params.sessionId)
  const threads = [...params.state.threads.values()]
    .filter((thread) => thread.sessionId === params.sessionId)
    .map((thread) => thread.threadId)
  return [...new Set([...(session === undefined ? [] : [session.mainThreadId]), ...threads])]
}

export const readSessionSubscriptionRowsIn = (params: {
  state: State
  sessionId: string
}): SubscriptionRow[] => {
  const threadIds = new Set(
    threadIdsOfSessionIn({ state: params.state, sessionId: params.sessionId }),
  )
  return [...params.state.subscriptions.values()]
    .filter((row) => threadIds.has(row.threadId))
    .map((row) => ({ ...row, events: [...row.events] }))
}

export const insertSubscriptionRowIn = (params: {
  state: State
  row: SubscriptionDraft
}): WrittenSubscriptionRow => {
  const held = findSubscriptionIn({ state: params.state, key: params.row })
  if (held !== undefined) return { row: held, inserted: false }
  const row: SubscriptionRow = { ...params.row, subscriptionId: crypto.randomUUID() }
  params.state.subscriptions.set(row.subscriptionId, { ...row, events: [...row.events] })
  return { row, inserted: true }
}

export const updateSubscriptionRowIn = (params: {
  state: State
  subscriptionId: string
  provider: string
  target: SubscriptionRow['target']
  label: string
  events: readonly string[]
  expiresAt: string | null
  deadline: string | null
}): boolean => {
  const row = params.state.subscriptions.get(params.subscriptionId)
  if (row === undefined) return false
  row.provider = params.provider
  row.target = params.target
  row.label = params.label
  row.events = [...params.events]
  row.expiresAt = params.expiresAt
  row.deadline = params.deadline
  return true
}

export const deleteSubscriptionRowIn = (params: {
  state: State
  subscriptionId: string
}): boolean => params.state.subscriptions.delete(params.subscriptionId)

const endingOf = (row: SubscriptionRow): string | null => row.deadline ?? row.expiresAt

const endedBefore = (row: SubscriptionRow, at: string): boolean => {
  const ending = endingOf(row)
  return ending !== null && Date.parse(ending) < Date.parse(at)
}

const liveAt = (row: SubscriptionRow, at: string): boolean => {
  const ending = endingOf(row)
  return ending === null || Date.parse(ending) > Date.parse(at)
}

export const laterLiveUntilOf = (held: string | null, next: string | null): string | null => {
  if (held === null || next === null) return null
  return Date.parse(held) > Date.parse(next) ? held : next
}

export const releasePullRequestTrackingIn = (
  params: ReleasePullRequestTrackingParams & { state: State },
): void => {
  const repoFullName = repoFullNameOf(params.repoFullName)
  const stillLive = [...params.state.subscriptions.values()].some(
    (row) =>
      row.userId === params.userId &&
      row.repoFullName === repoFullName &&
      row.prNumber === params.prNumber &&
      liveAt(row, params.at),
  )
  if (stillLive) return
  const key = trackingTargetKey({
    userId: params.userId,
    kind: 'pull-request',
    repoFullName,
    branch: '',
    prNumber: params.prNumber,
    liveUntil: null,
  })
  const held = params.state.trackingTargets.get(key)
  if (held === undefined) return
  params.state.trackingTargets.set(key, { ...held, liveUntil: params.at })
}

export const deleteSubscriptionRowIfEndedBeforeIn = (params: {
  state: State
  subscriptionId: string
  at: string
}): boolean => {
  const row = params.state.subscriptions.get(params.subscriptionId)
  if (row === undefined || !endedBefore(row, params.at)) return false
  return params.state.subscriptions.delete(params.subscriptionId)
}

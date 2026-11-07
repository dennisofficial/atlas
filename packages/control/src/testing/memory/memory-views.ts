import type {
  PrStateRow,
  SessionPullRequestKey,
  SessionPullRequestRow,
  SessionViewRow,
} from '../../port'
import { prKey, type State } from './memory-state'

export const readSessionViewIn = (params: {
  state: State
  sessionId: string
}): SessionViewRow | undefined => {
  const row = params.state.views.get(params.sessionId)
  return row === undefined ? undefined : { ...row }
}

export const writeSessionViewIn = (params: { state: State; row: SessionViewRow }): void => {
  params.state.views.set(params.row.sessionId, { ...params.row })
}

export const insertSessionPullRequestsIn = (params: {
  state: State
  rows: readonly SessionPullRequestRow[]
}): void => {
  for (const row of params.rows) {
    params.state.pullRequestLinks.add(`${row.sessionId} ${prKey(row)}`)
  }
}

export const sessionsLinkedToIn = (params: {
  state: State
  key: SessionPullRequestKey
}): string[] => {
  const suffix = ` ${prKey(params.key)}`
  return [...params.state.pullRequestLinks]
    .filter((entry) => entry.endsWith(suffix))
    .map((entry) => entry.slice(0, entry.length - suffix.length))
}

export const readPrStatesIn = (params: {
  state: State
  keys: readonly SessionPullRequestKey[]
}): PrStateRow[] =>
  params.keys.flatMap((key) => {
    const row = params.state.prStates.get(prKey(key))
    return row === undefined ? [] : [{ ...row }]
  })

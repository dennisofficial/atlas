import {
  EPullRequestChecksStateWire,
  EPullRequestStateWire,
  type GithubPrState,
  type PrStateWire,
} from '@dltech/atlas-wire/web'

import { pullRequestKeyOf } from './pull-request-entries'

const KNOWN_STATES: ReadonlySet<string> = new Set(Object.values(EPullRequestStateWire))
const KNOWN_CHECKS_STATES: ReadonlySet<string> = new Set(Object.values(EPullRequestChecksStateWire))

export function prStateWireOfApi(state: GithubPrState): PrStateWire | undefined {
  if (!KNOWN_STATES.has(state.state)) return undefined
  return {
    repo: state.repoFullName,
    number: state.prNumber,
    url: state.url,
    branch: state.headBranch,
    state: state.state as EPullRequestStateWire,
    title: state.title,
    checksRunning: state.checksRunning,
    checksPassed: state.checksPassed,
    checksFailed: state.checksFailed,
    checksState: KNOWN_CHECKS_STATES.has(state.checksState ?? '')
      ? (state.checksState as EPullRequestChecksStateWire)
      : undefined,
    mergeable: state.mergeable,
    ...(state.polled === undefined ? {} : { polled: state.polled }),
  }
}

function isTerminal(state: PrStateWire): boolean {
  return (
    state.state === EPullRequestStateWire.Merged || state.state === EPullRequestStateWire.Closed
  )
}

export function mergePrStates(args: {
  live: readonly PrStateWire[]
  api: readonly PrStateWire[]
}): PrStateWire[] {
  const byKey = new Map<string, PrStateWire>()
  for (const state of args.api) byKey.set(pullRequestKeyOf(state), state)
  for (const state of args.live) {
    const key = pullRequestKeyOf(state)
    const apiState = byKey.get(key)
    if (apiState && isTerminal(apiState) && !isTerminal(state)) continue
    byKey.set(key, {
      ...state,
      title: state.title ?? apiState?.title,
      checksState: state.checksState ?? apiState?.checksState,
      polled: state.polled ?? apiState?.polled,
    })
  }
  return [...byKey.values()]
}

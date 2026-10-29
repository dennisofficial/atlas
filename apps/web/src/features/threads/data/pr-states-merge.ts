import { EPullRequestStateWire, type GithubPrState, type PrStateWire } from '@dltech/atlas-wire/web'

import { pullRequestKeyOf } from './pull-request-entries'

const KNOWN_STATES: ReadonlySet<string> = new Set(Object.values(EPullRequestStateWire))

export function prStateWireOfApi(state: GithubPrState): PrStateWire | undefined {
  if (!KNOWN_STATES.has(state.state)) return undefined
  return {
    repo: state.repoFullName,
    number: state.prNumber,
    url: state.url,
    branch: state.headBranch,
    state: state.state as EPullRequestStateWire,
    checksRunning: state.checksRunning,
    checksPassed: state.checksPassed,
    checksFailed: state.checksFailed,
    mergeable: state.mergeable,
  }
}

export function mergePrStates(args: {
  live: readonly PrStateWire[]
  api: readonly PrStateWire[]
}): PrStateWire[] {
  const byKey = new Map<string, PrStateWire>()
  for (const state of args.api) byKey.set(pullRequestKeyOf(state), state)
  for (const state of args.live) byKey.set(pullRequestKeyOf(state), state)
  return [...byKey.values()]
}

import type { Row } from '@dltech/atlas-db'
import type { GithubPrStateFields, GithubPrStateRecord } from './github-realtime.types'

type CarriedPrStateFields = GithubPrStateFields & {
  headRepoFullName: string | null
  mergeClean?: boolean | null
  requiredCheckContexts?: readonly string[]
}

export function stateFieldsOf(row: Row<'GithubPrState'>): GithubPrStateFields & {
  headRepoFullName: string | null
  mergeClean: boolean | null
  requiredCheckContexts: readonly string[]
} {
  return {
    title: row.title,
    url: row.url,
    state: row.state,
    headBranch: row.headBranch,
    headSha: row.headSha,
    headRepoFullName: row.headRepoFullName,
    checksRunning: row.checksRunning,
    checksPassed: row.checksPassed,
    checksFailed: row.checksFailed,
    checksIgnored: row.checksIgnored,
    checksState: row.checksState,
    mergeable: row.mergeable,
    mergeClean: row.mergeClean,
    requiredCheckContexts: row.requiredCheckContexts,
  }
}

/**
 * Check tallies, GitHub's rollup state and mergeable describe a commit, not a PR, so they carry
 * forward only while the head sha is unchanged; a new head resets them until the next REST fill.
 */
export function carryChecks(args: {
  fields: GithubPrStateRecord
  prior: CarriedPrStateFields | null
}): GithubPrStateRecord {
  if (args.prior === null) return args.fields
  if (args.prior.headSha !== args.fields.headSha) return args.fields
  return {
    ...args.fields,
    checksRunning: args.prior.checksRunning,
    checksPassed: args.prior.checksPassed,
    checksFailed: args.prior.checksFailed,
    checksIgnored: args.prior.checksIgnored,
    checksState: args.prior.checksState,
    mergeable: args.prior.mergeable,
    mergeClean: args.prior.mergeClean ?? null,
    requiredCheckContexts: args.prior.requiredCheckContexts ?? [],
  }
}

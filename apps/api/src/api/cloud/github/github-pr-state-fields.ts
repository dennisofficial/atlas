import type { Row } from '@dltech/atlas-db'
import type { GithubPrStateFields, GithubPrStateRecord } from './github-realtime.types'

export function stateFieldsOf(row: Row<'GithubPrState'>): GithubPrStateFields & {
  headRepoFullName: string | null
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
    mergeable: row.mergeable,
  }
}

/**
 * Check tallies and mergeable describe a commit, not a PR, so they carry forward only while
 * the head sha is unchanged; a new head resets them until the next REST fill.
 */
export function carryChecks(args: {
  fields: GithubPrStateRecord
  prior: (GithubPrStateFields & { headRepoFullName: string | null }) | null
}): GithubPrStateRecord {
  if (args.prior === null) return args.fields
  if (args.prior.headSha !== args.fields.headSha) return args.fields
  return {
    ...args.fields,
    checksRunning: args.prior.checksRunning,
    checksPassed: args.prior.checksPassed,
    checksFailed: args.prior.checksFailed,
    checksIgnored: args.prior.checksIgnored,
    mergeable: args.prior.mergeable,
  }
}

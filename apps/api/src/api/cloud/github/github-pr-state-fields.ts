import type { GithubPrStateModel } from '../../../db'
import type { GithubPrStateFields, GithubPrStateRecord } from './github-realtime.types'

export type CheckTarget = {
  repoFullName: string
  branch: string | null
  sha: string | null
}

export function stateFieldsOf(row: GithubPrStateModel): GithubPrStateFields & {
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
    mergeable: args.prior.mergeable,
  }
}

export function provisionalFieldsOf(args: {
  target: CheckTarget
  prior: GithubPrStateFields & { headRepoFullName: string | null }
}): GithubPrStateRecord {
  const headSha = args.target.sha ?? args.prior.headSha
  const shaMoved = headSha !== args.prior.headSha
  return {
    title: args.prior.title,
    url: args.prior.url,
    state: args.prior.state,
    headBranch: args.target.branch ?? args.prior.headBranch,
    headSha,
    headRepoFullName: args.prior.headRepoFullName,
    checksRunning: shaMoved ? 1 : Math.max(args.prior.checksRunning, 1),
    checksPassed: shaMoved ? 0 : args.prior.checksPassed,
    checksFailed: shaMoved ? 0 : args.prior.checksFailed,
    mergeable: null,
    updatedAt: new Date(),
  }
}

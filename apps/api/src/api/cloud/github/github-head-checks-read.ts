import type { RestCheckRun, RestCommitStatus } from './github-pull-request-mapping'
import { type CommitCheckInput, restCommitChecksOf } from './github-commit-checks'

export async function readHeadChecks(args: {
  get: <T>(path: string) => Promise<T>
  owner: string
  repo: string
  headSha: string
}): Promise<{
  checkRuns: RestCheckRun[]
  statuses: RestCommitStatus[]
  checks: CommitCheckInput[]
}> {
  const base = `/repos/${args.owner}/${args.repo}/commits/${args.headSha}`
  const runs = await args.get<{ check_runs: RestCheckRun[] }>(`${base}/check-runs?per_page=100`)
  const status = await args.get<{ statuses: RestCommitStatus[] }>(`${base}/status`)
  return {
    checkRuns: runs.check_runs,
    statuses: status.statuses,
    checks: restCommitChecksOf({
      checkRuns: runs.check_runs,
      statuses: status.statuses,
    }),
  }
}

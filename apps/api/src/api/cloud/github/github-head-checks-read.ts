import type { RestCheckRun, RestCommitStatus } from './github-pull-request-mapping'
import { type CheckSuiteShape, checkSuiteInputOf } from './github-check-suites'
import { type CommitCheckInput, restCommitChecksOf } from './github-commit-checks'

export async function readHeadChecks(args: {
  get: <T>(path: string) => Promise<T>
  owner: string
  repo: string
  headSha: string
  withSuites: boolean
}): Promise<{
  checkRuns: RestCheckRun[]
  statuses: RestCommitStatus[]
  checks: CommitCheckInput[]
}> {
  const base = `/repos/${args.owner}/${args.repo}/commits/${args.headSha}`
  const runs = await args.get<{ check_runs: RestCheckRun[] }>(`${base}/check-runs?per_page=100`)
  const status = await args.get<{ statuses: RestCommitStatus[] }>(`${base}/status`)
  const suites = args.withSuites
    ? (await args.get<{ check_suites: CheckSuiteShape[] }>(`${base}/check-suites?per_page=100`))
        .check_suites
    : []
  return {
    checkRuns: runs.check_runs,
    statuses: status.statuses,
    checks: [
      ...restCommitChecksOf({
        checkRuns: runs.check_runs,
        statuses: status.statuses,
      }),
      ...suites.map(checkSuiteInputOf),
    ],
  }
}

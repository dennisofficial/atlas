export const RUN_KEY_PREFIX = 'run:'
export const SUITE_KEY_PREFIX = 'suite:'

export const GITHUB_ACTIONS_APP_SLUG = 'github-actions'

export type CheckSuiteShape = {
  status?: string | null
  conclusion?: string | null
  latest_check_runs_count?: number | null
  app?: { slug?: string | null } | null
}

const PENDING_SUITE_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending'])

// GitHub leaves a queued suite with no check runs for every installed app that runs nothing for the
// commit, so only a GitHub Actions suite may be pending while it has no check runs:
// https://docs.github.com/en/rest/checks/suites
const suiteIsPending = (suite: CheckSuiteShape): boolean => {
  const status = suite.status ?? null
  if (status === null || status === 'completed') return false
  if (suite.conclusion !== null && suite.conclusion !== undefined) return false
  if (!PENDING_SUITE_STATUSES.has(status)) return false
  if (suite.app?.slug === GITHUB_ACTIONS_APP_SLUG) return true
  return (suite.latest_check_runs_count ?? 0) > 0
}

export const pendingCheckSuiteCountOf = (suites: readonly CheckSuiteShape[]): number =>
  suites.filter(suiteIsPending).length

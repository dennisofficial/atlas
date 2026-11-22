export const PULL_REQUEST_KIND = 'pull-request'
export const WORKFLOW_RUN_KIND = 'workflow-run'

const RUN_PREFIX = '#run:'
const WORKFLOW_PREFIX = '#workflow:'

export const runBranchOf = (args: { runId: number }): string => `${RUN_PREFIX}${args.runId}`

export const workflowBranchOf = (args: { workflow: string; branch: string }): string =>
  `${WORKFLOW_PREFIX}${args.workflow}@${args.branch}`

export type RunSelector =
  | { selector: 'run'; runId: number }
  | { selector: 'workflow'; workflow: string; branch: string }

/** Reads back the discriminator a workflow-run link writes into `GithubSubscription.branch`. */
export function runSelectorOf(branch: string): RunSelector | null {
  if (branch.startsWith(RUN_PREFIX)) {
    const runId = Number(branch.slice(RUN_PREFIX.length))
    return Number.isInteger(runId) && runId > 0 ? { selector: 'run', runId } : null
  }
  if (!branch.startsWith(WORKFLOW_PREFIX)) return null
  const rest = branch.slice(WORKFLOW_PREFIX.length)
  const at = rest.lastIndexOf('@')
  if (at <= 0 || at === rest.length - 1) return null
  return { selector: 'workflow', workflow: rest.slice(0, at), branch: rest.slice(at + 1) }
}

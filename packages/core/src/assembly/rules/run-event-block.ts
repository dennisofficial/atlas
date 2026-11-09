import { systemNotice } from '../../context/envelope'
import type { DraftOfType } from '../../events/envelope'

type RunEvent = DraftOfType<'run-event'>

const FAILED_JOB_LIMIT = 10

const jobList = (jobs: readonly string[]): string => {
  const named = jobs.slice(0, FAILED_JOB_LIMIT).join(', ')
  const extra = jobs.length - FAILED_JOB_LIMIT
  return extra > 0 ? `${named} and ${extra} more` : named
}

const outcomeOf = (event: RunEvent): string => {
  const failed = event.failedJobs ?? []
  if (event.conclusion === 'success') return 'completed, all jobs passed'
  if (event.conclusion === 'failure' && failed.length > 0)
    return `completed, failure — failed jobs: ${jobList(failed)}`
  if (event.conclusion === 'failure') return 'completed, failure'
  if (event.conclusion === '') return `completed (${event.status})`
  return `completed, ${event.conclusion}`
}

export function runEventContent(event: RunEvent): string {
  const where = event.branch === '' ? '' : ` on ${event.branch}`
  return `Workflow run ${event.workflow} #${event.workflowRunId} in ${event.repo}${where}: ${outcomeOf(event)}. ${event.url}`
}

export function runEventBlock(event: RunEvent): string {
  return systemNotice({ kind: 'run-event', content: runEventContent(event) })
}

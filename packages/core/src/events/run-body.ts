import type { NoticeStamp } from './notice-stage'

export type RunEventBody = {
  type: 'run-event'
  repo: string
  workflowRunId: number
  workflow: string
  branch: string
  url: string
  status: string
  conclusion: string
  headSha?: string | undefined
  eventId?: string | undefined
  failedJobs?: readonly string[] | undefined
  notice?: NoticeStamp | undefined
}

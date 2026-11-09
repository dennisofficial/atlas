import { describe, expect, it } from 'bun:test'

import { runEventBlock, runEventContent } from '../run-event-block'

const RUN_URL = 'https://github.com/dltech/atlas/actions/runs/33522901117'

const success = {
  type: 'run-event',
  repo: 'github.com/dltech/atlas',
  workflowRunId: 33522901117,
  workflow: 'Build',
  branch: 'dennis/subscriptions',
  url: RUN_URL,
  status: 'completed',
  conclusion: 'success',
} as const

describe('run event content', () => {
  it('names the workflow, the run, the repo and the branch, and ends with the url', () => {
    expect(runEventContent(success)).toBe(
      `Workflow run Build #33522901117 in github.com/dltech/atlas on dennis/subscriptions: completed, all jobs passed. ${RUN_URL}`,
    )
  })

  it('lists the failed jobs of a failure', () => {
    const content = runEventContent({
      ...success,
      conclusion: 'failure',
      failedJobs: ['deploy', 'publish'],
    })
    expect(content).toContain('completed, failure — failed jobs: deploy, publish.')
  })

  it('caps the job list and counts the rest', () => {
    const jobs = Array.from({ length: 13 }, (_, index) => `job-${index + 1}`)
    const content = runEventContent({ ...success, conclusion: 'failure', failedJobs: jobs })
    expect(content).toContain('job-10 and 3 more')
    expect(content).not.toContain('job-11')
  })

  it('says failure without a job list when GitHub reported none', () => {
    expect(runEventContent({ ...success, conclusion: 'failure' })).toContain('completed, failure.')
  })

  it('names any other conclusion as GitHub reported it', () => {
    expect(runEventContent({ ...success, conclusion: 'cancelled' })).toContain(
      'completed, cancelled.',
    )
  })

  it('leaves out the branch phrase when GitHub reported no branch', () => {
    expect(runEventContent({ ...success, branch: '' })).toContain(
      'in github.com/dltech/atlas: completed',
    )
  })

  it('renders as a system notice so it reads as delivery, not operator speech', () => {
    const block = runEventBlock(success)
    expect(block).toContain('kind="run-event"')
    expect(block).toContain(RUN_URL)
  })
})

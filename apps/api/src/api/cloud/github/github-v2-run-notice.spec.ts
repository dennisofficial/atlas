import { describe, expect, it } from 'bun:test'

import type { WorkflowRunSnapshot } from './github-run-snapshot'
import { runNoticeText } from './github-v2-run-notice'

const RUN: WorkflowRunSnapshot = {
  id: '9001',
  status: 'completed',
  conclusion: 'success',
  name: 'ci',
  headBranch: 'main',
  url: 'https://github.com/compai/app/actions/runs/9001',
  failedJobs: [],
}

describe('v2 run notice text', () => {
  it('names the workflow, run id, repo, branch, conclusion and url', () => {
    expect(runNoticeText({ repoFullName: 'compai/app', run: RUN })).toBe(
      'Workflow run ci #9001 in compai/app on main: completed, all jobs passed. https://github.com/compai/app/actions/runs/9001',
    )
  })

  it('names the failed jobs of a failed run, capped at ten', () => {
    const failedJobs = Array.from({ length: 12 }, (_, index) => `job-${index}`)
    expect(
      runNoticeText({
        repoFullName: 'compai/app',
        run: { ...RUN, conclusion: 'failure', failedJobs },
      }),
    ).toBe(
      'Workflow run ci #9001 in compai/app on main: completed, failure — failed jobs: job-0, job-1, job-2, job-3, job-4, job-5, job-6, job-7, job-8, job-9 and 2 more. https://github.com/compai/app/actions/runs/9001',
    )
  })

  it('drops the branch when the run carries none', () => {
    expect(runNoticeText({ repoFullName: 'compai/app', run: { ...RUN, headBranch: '' } })).toBe(
      'Workflow run ci #9001 in compai/app: completed, all jobs passed. https://github.com/compai/app/actions/runs/9001',
    )
  })
})

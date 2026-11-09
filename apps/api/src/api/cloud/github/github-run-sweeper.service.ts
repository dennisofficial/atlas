import { Injectable, Logger } from '@nestjs/common'
import { db, type Row } from '@dltech/atlas-db'

import { EGithubCallSource } from './github-call-log'
import { WORKFLOW_RUN_KIND, runSelectorOf, type RunSelector } from './github-run-selector'
import { GithubSandboxWakeService } from './github-sandbox-wake.service'
import { failureText } from './github-sandbox-wake-boot'
import { GithubWorkflowRunReads, type WorkflowRunRead } from './github-workflow-run-reads'
import { GithubService } from './github.service'

/**
 * Notices the completion of the run a thread subscribed to and boots its parked sandbox; the pod
 * provider then reads the run and delivers the notice, so the API writes no run event. The
 * deliveredRunId write is the boot lock: two ticks, or two API instances, boot a run once.
 */
@Injectable()
export class GithubRunSweeperService {
  private readonly logger = new Logger(GithubRunSweeperService.name)

  constructor(
    private readonly github: GithubService,
    private readonly reads: GithubWorkflowRunReads,
    private readonly wake: GithubSandboxWakeService,
  ) {}

  async handleSweep(): Promise<void> {
    const now = new Date()
    const rows = await db.orm.public.GithubSubscription.where({
      kind: WORKFLOW_RUN_KIND,
      deliveredRunId: '',
    })
      .where((subscription) => subscription.threadId.neq(''))
      .where((subscription) => subscription.liveUntil.gt(now))
      .all()
    for (const row of rows) await this.sweepOne(row)
  }

  private async sweepOne(row: Row<'GithubSubscription'>): Promise<void> {
    const selector = runSelectorOf(row.branch)
    if (selector === null) return
    const token = await this.github.findToken({ userId: row.userId })
    if (token === undefined) return
    const [owner, repo] = row.repoFullName.split('/') as [string, string]
    const read = await this.readRun({ selector, token, owner, repo }).catch((failure: unknown) => {
      this.logger.warn(
        `reading ${row.repoFullName} ${row.branch} for thread ${row.threadId} failed: ${failureText(failure)}`,
      )
      return undefined
    })
    if (read === undefined || read.outcome !== 'found') return
    const run = read.run
    if (run.status !== 'completed') return
    const claimed = await db.orm.public.GithubSubscription.where({
      id: row.id,
      deliveredRunId: '',
    }).updateAndCount({ deliveredRunId: run.id })
    if (claimed === 0) return
    this.logger.log(
      `waking thread ${row.threadId} for the completed run ${run.id} of ${row.repoFullName}`,
    )
    this.wake.notifyEvent({
      userId: row.userId,
      repoFullName: row.repoFullName,
      kind: 'workflow-run',
    })
  }

  private readRun(args: {
    selector: RunSelector
    token: string
    owner: string
    repo: string
  }): Promise<WorkflowRunRead> {
    if (args.selector.selector === 'run') {
      return this.reads.readWorkflowRun({
        source: EGithubCallSource.PollSweep,
        token: args.token,
        owner: args.owner,
        repo: args.repo,
        runId: args.selector.runId,
      })
    }
    return this.reads.latestWorkflowRun({
      source: EGithubCallSource.PollSweep,
      token: args.token,
      owner: args.owner,
      repo: args.repo,
      workflow: args.selector.workflow,
      branch: args.selector.branch,
    })
  }
}

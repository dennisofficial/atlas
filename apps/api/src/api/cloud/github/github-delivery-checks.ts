import { db } from '@dltech/atlas-db'
import { affectedPrsBySha } from './github-delivery-affected'
import {
  checkRunInputOf,
  commitChecksTally,
  commitStatusInputOf,
  recordCommitChecks,
} from './github-commit-checks'
import { GithubDeliveryFillDeferred, type RestFill } from './github-delivery-fill'
import { normalizedRepo } from './github-pr-identity'
import { stateFieldsOf } from './github-pr-state-fields'
import type { GithubPrStateWriter } from './github-pr-state-writer'
import type {
  GithubCheckRunWebhookPayload,
  GithubStatusWebhookPayload,
} from './github-webhook.types'
import type { ChecksCount } from '@dltech/atlas-core'

export class GithubDeliveryChecks {
  constructor(
    private readonly deps: {
      writer: GithubPrStateWriter
      restFill: (args: { repoFullName: string; prNumber: number }) => Promise<RestFill>
    },
  ) {}

  async handleCheckRun(payload: GithubCheckRunWebhookPayload): Promise<void> {
    const repoFullName = normalizedRepo(payload.repository.full_name)
    const headSha = payload.check_run.head_sha
    await recordCommitChecks({
      repoFullName,
      headSha,
      checks: [checkRunInputOf(payload.check_run)],
    })
    await this.recompute({ repoFullName, headSha })
  }

  async handleStatus(payload: GithubStatusWebhookPayload): Promise<void> {
    const repoFullName = normalizedRepo(payload.repository.full_name)
    await recordCommitChecks({
      repoFullName,
      headSha: payload.sha,
      checks: [commitStatusInputOf(payload)],
    })
    await this.recompute({ repoFullName, headSha: payload.sha })
  }

  private async recompute(args: { repoFullName: string; headSha: string }): Promise<void> {
    const affected = await affectedPrsBySha({
      repoFullName: args.repoFullName,
      sha: args.headSha,
    })
    if (affected.length === 0) return
    const tally = await commitChecksTally(args)
    const deferred: number[] = []

    for (const pr of affected) {
      if (await this.awaitsSettleConfirmation({ pr, tally })) {
        const rest = await this.deps.restFill({
          repoFullName: args.repoFullName,
          prNumber: pr.prNumber,
        })
        if (rest.kind === 'deferred') {
          deferred.push(pr.prNumber)
          continue
        }
        if (rest.kind === 'filled') {
          await this.deps.writer.recordAndPush({
            repoFullName: args.repoFullName,
            prNumber: pr.prNumber,
            fields: rest.fields,
          })
          continue
        }
      }
      if (countsMatch({ tally, pr })) continue
      await this.deps.writer.recordAndPush({
        repoFullName: args.repoFullName,
        prNumber: pr.prNumber,
        fields: {
          ...stateFieldsOf(pr),
          checksRunning: tally.running,
          checksPassed: tally.passed,
          checksFailed: tally.failed,
          checksIgnored: tally.ignored,
          updatedAt: new Date(),
        },
      })
    }

    if (deferred.length > 0) {
      throw new GithubDeliveryFillDeferred({
        repoFullName: args.repoFullName,
        prNumbers: deferred,
      })
    }
  }

  private async awaitsSettleConfirmation(args: {
    pr: { repoFullName: string; prNumber: number; headSha: string }
    tally: ChecksCount
  }): Promise<boolean> {
    const { tally } = args
    if (tally.running > 0 || tally.passed + tally.failed + tally.ignored === 0) return false
    const ledger = await db.orm.public.GithubPrHeadCheck.where({
      repoFullName: args.pr.repoFullName,
      prNumber: args.pr.prNumber,
      headSha: args.pr.headSha,
    }).first()
    return ledger?.settledAt == null
  }
}

function countsMatch(args: {
  tally: ChecksCount
  pr: {
    checksRunning: number
    checksPassed: number
    checksFailed: number
    checksIgnored: number
  }
}): boolean {
  return (
    args.pr.checksRunning === args.tally.running &&
    args.pr.checksPassed === args.tally.passed &&
    args.pr.checksFailed === args.tally.failed &&
    args.pr.checksIgnored === args.tally.ignored
  )
}

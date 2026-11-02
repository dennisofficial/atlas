import type { ChecksCount } from '@dltech/atlas-core'
import { db, type Row, type Tx } from '@dltech/atlas-db'
import { affectedPrsBySha } from './github-delivery-affected'
import {
  type CommitCheckInput,
  checkRunInputOf,
  commitChecksTally,
  commitStatusInputOf,
  lockCommit,
  recordCommitChecks,
} from './github-commit-checks'
import { GithubDeliveryFillDeferred, type RestFill } from './github-delivery-fill'
import { normalizedRepo } from './github-pr-identity'
import { stateFieldsOf } from './github-pr-state-fields'
import type { GithubPrStateWriter, PrStateWrite } from './github-pr-state-writer'
import { checkSuiteInputOf } from './github-check-suites'
import type {
  GithubCheckRunWebhookPayload,
  GithubCheckSuiteWebhookPayload,
  GithubStatusWebhookPayload,
} from './github-webhook.types'

export class GithubDeliveryChecks {
  constructor(
    private readonly deps: {
      writer: GithubPrStateWriter
      restFill: (args: { repoFullName: string; prNumber: number }) => Promise<RestFill>
    },
  ) {}

  handleCheckRun(payload: GithubCheckRunWebhookPayload): Promise<void> {
    return this.ingest({
      repoFullName: payload.repository.full_name,
      headSha: payload.check_run.head_sha,
      check: checkRunInputOf(payload.check_run),
    })
  }

  handleCheckSuite(payload: GithubCheckSuiteWebhookPayload): Promise<void> {
    const { check_suite: suite } = payload
    if (suite.id === undefined) return Promise.resolve()
    return this.ingest({
      repoFullName: payload.repository.full_name,
      headSha: suite.head_sha,
      check: checkSuiteInputOf({ ...suite, id: suite.id, status: suite.status ?? 'completed' }),
    })
  }

  handleStatus(payload: GithubStatusWebhookPayload): Promise<void> {
    return this.ingest({
      repoFullName: payload.repository.full_name,
      headSha: payload.sha,
      check: commitStatusInputOf(payload),
    })
  }

  private async ingest(args: {
    repoFullName: string
    headSha: string
    check: CommitCheckInput
  }): Promise<void> {
    const repoFullName = normalizedRepo(args.repoFullName)
    const { headSha } = args

    const decided = await db.transaction(async (tx) => {
      await lockCommit({ tx, repoFullName, headSha })
      await recordCommitChecks({ tx, repoFullName, headSha, checks: [args.check] })
      const affected = await affectedPrsBySha({ tx, repoFullName, sha: headSha })
      const tally = await commitChecksTally({ tx, repoFullName, headSha })
      const writes: PrStateWrite[] = []
      const confirm: number[] = []
      for (const pr of affected) {
        if (await awaitsSettleConfirmation({ tx, pr, tally })) {
          confirm.push(pr.prNumber)
          continue
        }
        if (countsMatch({ tally, pr })) continue
        writes.push(
          await this.deps.writer.writeState({
            tx,
            repoFullName,
            prNumber: pr.prNumber,
            fields: withTally({ pr, tally }),
          }),
        )
      }
      return { writes, confirm }
    })

    for (const write of decided.writes) await this.deps.writer.publish(write)

    const deferred: number[] = []
    for (const prNumber of decided.confirm) {
      const rest = await this.deps.restFill({ repoFullName, prNumber })
      if (rest.kind === 'deferred') {
        deferred.push(prNumber)
        continue
      }
      const write = await db.transaction(async (tx) => {
        const restHead = rest.kind === 'filled' ? rest.fields.headSha : headSha
        await lockCommit({ tx, repoFullName, headSha: restHead })
        if (rest.kind === 'filled' && rest.checks !== null) {
          await recordCommitChecks({ tx, repoFullName, headSha: restHead, checks: rest.checks })
        }
        const tally = await commitChecksTally({ tx, repoFullName, headSha: restHead })
        const fields =
          rest.kind === 'filled'
            ? rest.checks === null
              ? rest.fields
              : { ...rest.fields, ...countsOf(tally) }
            : withTally({ pr: await currentRow({ tx, repoFullName, prNumber }), tally })
        return this.deps.writer.writeState({ tx, repoFullName, prNumber, fields })
      })
      await this.deps.writer.publish(write)
    }

    if (deferred.length > 0) {
      throw new GithubDeliveryFillDeferred({ repoFullName, prNumbers: deferred })
    }
  }
}

async function currentRow(args: {
  tx: Tx
  repoFullName: string
  prNumber: number
}): Promise<Row<'GithubPrState'>> {
  return args.tx.orm.public.GithubPrState.where({
    repoFullName: args.repoFullName,
    prNumber: args.prNumber,
  }).first() as Promise<Row<'GithubPrState'>>
}

async function awaitsSettleConfirmation(args: {
  tx: Tx
  pr: { repoFullName: string; prNumber: number; headSha: string }
  tally: ChecksCount
}): Promise<boolean> {
  const { tally } = args
  if (tally.running > 0 || tally.passed + tally.failed + tally.ignored === 0) return false
  const ledger = await args.tx.orm.public.GithubPrHeadCheck.where({
    repoFullName: args.pr.repoFullName,
    prNumber: args.pr.prNumber,
    headSha: args.pr.headSha,
  }).first()
  return ledger?.settledAt == null
}

const countsOf = (tally: ChecksCount) => ({
  checksRunning: tally.running,
  checksPassed: tally.passed,
  checksFailed: tally.failed,
  checksIgnored: tally.ignored,
})

function withTally(args: { pr: Row<'GithubPrState'>; tally: ChecksCount }) {
  return { ...stateFieldsOf(args.pr), ...countsOf(args.tally), updatedAt: new Date() }
}

function countsMatch(args: { tally: ChecksCount; pr: Row<'GithubPrState'> }): boolean {
  return (
    args.pr.checksRunning === args.tally.running &&
    args.pr.checksPassed === args.tally.passed &&
    args.pr.checksFailed === args.tally.failed &&
    args.pr.checksIgnored === args.tally.ignored
  )
}

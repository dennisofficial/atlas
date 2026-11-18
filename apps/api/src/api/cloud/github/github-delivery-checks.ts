import type { ChecksCount } from '@dltech/atlas-core'
import { db, type Row, type Tx } from '@dltech/atlas-db'
import { affectedPrsBySha } from './github-delivery-affected'
import {
  type CommitCheckInput,
  checkCountFieldsOf,
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
import type { GithubPrStateRecord } from './github-realtime.types'
import { CheckAnnotationFetcher, type FetchAnnotations } from './github-check-annotations'
import type {
  GithubCheckRunWebhookPayload,
  GithubCheckSuiteWebhookPayload,
  GithubStatusWebhookPayload,
} from './github-webhook.types'

export class GithubDeliveryChecks {
  private readonly annotations: CheckAnnotationFetcher

  constructor(
    private readonly deps: {
      writer: GithubPrStateWriter
      restFill: (args: {
        repoFullName: string
        prNumber: number
        installationId: bigint | undefined
      }) => Promise<RestFill>
      fetchAnnotations: FetchAnnotations
    },
  ) {
    this.annotations = new CheckAnnotationFetcher(deps.fetchAnnotations)
  }

  handleCheckRun(payload: GithubCheckRunWebhookPayload, installationId?: bigint): Promise<void> {
    return this.ingest({
      repoFullName: payload.repository.full_name,
      headSha: payload.check_run.head_sha,
      check: checkRunInputOf(payload.check_run),
      installationId,
    })
  }

  /**
   * A suite is a container, never a check: its event re-reads the head's tally and can settle a
   * ledger, but records nothing of its own.
   */
  handleCheckSuite(
    payload: GithubCheckSuiteWebhookPayload,
    installationId?: bigint,
  ): Promise<void> {
    return this.ingest({
      repoFullName: payload.repository.full_name,
      headSha: payload.check_suite.head_sha,
      installationId,
    })
  }

  handleStatus(payload: GithubStatusWebhookPayload, installationId?: bigint): Promise<void> {
    return this.ingest({
      repoFullName: payload.repository.full_name,
      headSha: payload.sha,
      check: commitStatusInputOf(payload),
      installationId,
    })
  }

  private async ingest(args: {
    repoFullName: string
    headSha: string
    check?: CommitCheckInput
    installationId: bigint | undefined
  }): Promise<void> {
    const repoFullName = normalizedRepo(args.repoFullName)
    const { headSha } = args
    const check =
      args.check === undefined
        ? undefined
        : await this.annotations.attach({
            repoFullName,
            headSha,
            check: args.check,
            installationId: args.installationId,
          })

    const decided = await db.transaction(async (tx) => {
      await lockCommit({ tx, repoFullName, headSha })
      if (check !== undefined) {
        await recordCommitChecks({ tx, repoFullName, headSha, checks: [check] })
      }
      const affected = await affectedPrsBySha({ tx, repoFullName, sha: headSha })
      const tally = await commitChecksTally({ tx, repoFullName, headSha })
      const writes: PrStateWrite[] = []
      const confirm: Row<'GithubPrState'>[] = []
      for (const pr of affected) {
        if (await awaitsSettleConfirmation({ tx, pr, tally })) {
          confirm.push(pr)
          continue
        }
        if (countsMatch({ tally, pr })) continue
        const write = await this.deps.writer.writeState({
          tx,
          repoFullName,
          prNumber: pr.prNumber,
          fields: withTally({ pr, tally }),
        })
        if (write !== null) writes.push(write)
      }
      return { writes, confirm }
    })

    for (const write of decided.writes) await this.deps.writer.publish(write)

    const deferred: number[] = []
    for (const pr of decided.confirm) {
      const prNumber = pr.prNumber
      const rest = await this.deps.restFill({
        repoFullName,
        prNumber,
        installationId: args.installationId,
      })
      if (rest.kind === 'deferred') {
        deferred.push(prNumber)
        continue
      }
      const restHead = rest.kind === 'filled' ? rest.fields.headSha : headSha
      const restChecks =
        rest.kind === 'filled' && rest.checks !== null
          ? await this.withAnnotations({
              repoFullName,
              headSha: restHead,
              checks: rest.checks,
              installationId: args.installationId,
            })
          : null
      const write = await db.transaction(async (tx) => {
        await lockCommit({ tx, repoFullName, headSha: restHead })
        if (restChecks !== null) {
          await recordCommitChecks({ tx, repoFullName, headSha: restHead, checks: restChecks })
        }
        const tally = await commitChecksTally({ tx, repoFullName, headSha: restHead })
        const stored = await currentRow({ tx, repoFullName, prNumber })
        const fields = settleFieldsOf({
          kind: rest.kind,
          sameHead: rest.kind === 'filled' && rest.fields.headSha === pr.headSha,
          fill: rest.kind === 'filled' ? rest.fields : null,
          hasChecks: rest.kind === 'filled' && rest.checks !== null,
          stored,
          tally,
        })
        return this.deps.writer.writeState({
          tx,
          repoFullName,
          prNumber,
          fields,
          seenHeadSha: rest.kind === 'filled' ? pr.headSha : undefined,
        })
      })
      if (write !== null) await this.deps.writer.publish(write)
    }

    if (deferred.length > 0) {
      throw new GithubDeliveryFillDeferred({ repoFullName, prNumbers: deferred })
    }
  }

  private withAnnotations(args: {
    repoFullName: string
    headSha: string
    checks: readonly CommitCheckInput[]
    installationId: bigint | undefined
  }): Promise<CommitCheckInput[]> {
    return Promise.all(
      args.checks.map((check) =>
        this.annotations.attach({
          repoFullName: args.repoFullName,
          headSha: args.headSha,
          check,
          installationId: args.installationId,
        }),
      ),
    )
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

function settleFieldsOf(args: {
  kind: RestFill['kind']
  sameHead: boolean
  fill: GithubPrStateRecord | null
  hasChecks: boolean
  stored: Row<'GithubPrState'>
  tally: ChecksCount
}): GithubPrStateRecord {
  if (args.fill === null) return withTally({ pr: args.stored, tally: args.tally })
  if (!args.sameHead) {
    return args.hasChecks ? { ...args.fill, ...checkCountFieldsOf(args.tally) } : args.fill
  }
  return {
    ...stateFieldsOf(args.stored),
    checksRunning: args.fill.checksRunning,
    checksPassed: args.fill.checksPassed,
    checksFailed: args.fill.checksFailed,
    checksIgnored: args.fill.checksIgnored,
    checksState: args.fill.checksState,
    requiredCheckContexts:
      args.fill.requiredCheckContexts ?? args.stored.requiredCheckContexts ?? [],
    ...(args.hasChecks ? checkCountFieldsOf(args.tally) : {}),
    updatedAt: new Date(),
  }
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

function withTally(args: { pr: Row<'GithubPrState'>; tally: ChecksCount }) {
  return { ...stateFieldsOf(args.pr), ...checkCountFieldsOf(args.tally), updatedAt: new Date() }
}

function countsMatch(args: { tally: ChecksCount; pr: Row<'GithubPrState'> }): boolean {
  return (
    args.pr.checksRunning === args.tally.running &&
    args.pr.checksPassed === args.tally.passed &&
    args.pr.checksFailed === args.tally.failed &&
    args.pr.checksIgnored === args.tally.ignored
  )
}

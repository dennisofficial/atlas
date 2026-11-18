import { EPrSource, type ChecksCount, type PrObservation } from '@dltech/atlas-core'
import { db, type Tx } from '@dltech/atlas-db'
import { affectedPrsBySha } from './github-delivery-affected'
import {
  type CommitCheckInput,
  checkRunInputOf,
  commitChecksTally,
  commitStatusInputOf,
  lockCommit,
  recordCommitChecks,
} from './github-commit-checks'
import { GithubDeliveryFillDeferred, type FillFields, type RestFill } from './github-delivery-fill'
import { normalizedRepo } from './github-pr-identity'
import type { GithubPrStore } from './github-pr-store'
import { CheckAnnotationFetcher, type FetchAnnotations } from './github-check-annotations'
import type {
  GithubCheckRunWebhookPayload,
  GithubCheckSuiteWebhookPayload,
  GithubStatusWebhookPayload,
} from './github-webhook.types'

type SettleTarget = { prNumber: number; baseBranch: string }

export class GithubDeliveryChecks {
  private readonly annotations: CheckAnnotationFetcher

  constructor(
    private readonly deps: {
      store: GithubPrStore
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
      const refresh: number[] = []
      const confirm: SettleTarget[] = []
      for (const pr of affected) {
        if (await awaitsSettleConfirmation({ tx, pr, tally })) {
          confirm.push({ prNumber: pr.prNumber, baseBranch: pr.baseBranch })
          continue
        }
        refresh.push(pr.prNumber)
      }
      return { refresh, confirm }
    })

    for (const prNumber of decided.refresh) {
      await this.deps.store.apply({ repoFullName, prNumber, observations: [] })
    }

    const deferred: number[] = []
    for (const target of decided.confirm) {
      const settled = await this.settle({
        repoFullName,
        target,
        headSha,
        installationId: args.installationId,
      })
      if (!settled) deferred.push(target.prNumber)
    }

    if (deferred.length > 0) {
      throw new GithubDeliveryFillDeferred({ repoFullName, prNumbers: deferred })
    }
  }

  private async settle(args: {
    repoFullName: string
    target: SettleTarget
    headSha: string
    installationId: bigint | undefined
  }): Promise<boolean> {
    const rest = await this.deps.restFill({
      repoFullName: args.repoFullName,
      prNumber: args.target.prNumber,
      installationId: args.installationId,
    })
    if (rest.kind === 'deferred') return false

    const fill = rest.kind === 'filled' ? rest.fields : null
    const fillHead = fill?.headSha ?? args.headSha
    if (rest.kind === 'filled' && rest.checks !== null && rest.checks.length > 0) {
      const checks = await this.withAnnotations({
        repoFullName: args.repoFullName,
        headSha: fillHead,
        checks: rest.checks,
        installationId: args.installationId,
      })
      await db.transaction(async (tx) => {
        await lockCommit({ tx, repoFullName: args.repoFullName, headSha: fillHead })
        await recordCommitChecks({
          tx,
          repoFullName: args.repoFullName,
          headSha: fillHead,
          checks,
        })
      })
    }

    const protection = rest.kind === 'filled' ? rest.protection : null

    await this.deps.store.apply({
      repoFullName: args.repoFullName,
      prNumber: args.target.prNumber,
      observations: mergeabilityObservationsOf({
        fill,
        baseBranch: args.target.baseBranch,
        observedAt: new Date().toISOString(),
      }),
      ...(protection === null ? {} : { protection }),
    })

    return true
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

function mergeabilityObservationsOf(args: {
  fill: FillFields | null
  baseBranch: string
  observedAt: string
}): readonly PrObservation[] {
  const fill = args.fill
  if (fill === null || fill.headSha === '' || args.baseBranch === '') return []

  return [
    {
      kind: 'mergeability',
      source: EPrSource.DeliveryFill,
      observedAt: args.observedAt,
      sample: {
        headSha: fill.headSha,
        baseBranch: args.baseBranch,
        mergeable: fill.mergeable,
        mergeClean: fill.mergeClean ?? null,
        observedAt: args.observedAt,
      },
    },
  ]
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

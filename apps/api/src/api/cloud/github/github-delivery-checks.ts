import { EPrSource, type PrObservation } from '@dltech/atlas-core'
import { db } from '@dltech/atlas-db'
import {
  type CommitCheckInput,
  checkRunInputOf,
  commitStatusInputOf,
  recordCommitChecks,
} from './github-commit-checks'
import { GithubDeliveryFillDeferred, type FillFields, type RestFill } from './github-delivery-fill'
import { normalizedRepo } from './github-pr-identity'
import { lockPrScope } from './github-pr-lock'
import type { GithubPrStore } from './github-pr-store'
import { headShaPrNumbers, inWatchScope } from './github-watch-scope'
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
      prNumbers: payload.check_run.pull_requests?.map((pull) => pull.number) ?? [],
      branch: payload.check_run.check_suite?.head_branch ?? null,
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
      prNumbers: payload.check_suite.pull_requests?.map((pull) => pull.number) ?? [],
      branch: payload.check_suite.head_branch,
      installationId,
    })
  }

  handleStatus(payload: GithubStatusWebhookPayload, installationId?: bigint): Promise<void> {
    return this.ingest({
      repoFullName: payload.repository.full_name,
      headSha: payload.sha,
      check: commitStatusInputOf(payload),
      prNumbers: [],
      branch: payload.branches?.[0]?.name ?? null,
      installationId,
    })
  }

  private async ingest(args: {
    repoFullName: string
    headSha: string
    check?: CommitCheckInput
    prNumbers: readonly number[]
    branch: string | null
    installationId: bigint | undefined
  }): Promise<void> {
    const repoFullName = normalizedRepo(args.repoFullName)
    const { headSha } = args
    if (
      !(await this.watched({
        repoFullName,
        headSha,
        prNumbers: args.prNumbers,
        branch: args.branch,
      }))
    )
      return
    const checks =
      args.check === undefined
        ? []
        : [
            await this.annotations.attach({
              repoFullName,
              headSha,
              check: args.check,
              installationId: args.installationId,
            }),
          ]

    const applied = await this.deps.store.applyChecks({ repoFullName, headSha, checks })
    const deferred: number[] = []
    for (const prNumber of applied.awaitingSettle) {
      const settled = await this.settle({
        repoFullName,
        prNumber,
        headSha,
        installationId: args.installationId,
      })
      if (!settled) deferred.push(prNumber)
    }

    if (deferred.length > 0) {
      throw new GithubDeliveryFillDeferred({ repoFullName, prNumbers: deferred })
    }
  }

  private async watched(args: {
    repoFullName: string
    headSha: string
    prNumbers: readonly number[]
    branch: string | null
  }): Promise<boolean> {
    const prNumbers =
      args.prNumbers.length > 0
        ? args.prNumbers
        : [
            ...(await headShaPrNumbers({
              repoFullName: args.repoFullName,
              headSha: args.headSha,
            })),
          ]

    return await inWatchScope({
      repoFullName: args.repoFullName,
      prNumbers,
      heads: args.branch === null ? [] : [{ repoFullName: args.repoFullName, branch: args.branch }],
    })
  }

  private async settle(args: {
    repoFullName: string
    prNumber: number
    headSha: string
    installationId: bigint | undefined
  }): Promise<boolean> {
    const rest = await this.deps.restFill({
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
      installationId: args.installationId,
    })
    if (rest.kind === 'deferred') return false

    const fill = rest.kind === 'filled' ? rest.fields : null
    const headSha = fill?.headSha ?? args.headSha
    const checks =
      rest.kind === 'filled' && rest.checks !== null && rest.checks.length > 0
        ? await this.withAnnotations({
            repoFullName: args.repoFullName,
            headSha,
            checks: rest.checks,
            installationId: args.installationId,
          })
        : []
    const protection = rest.kind === 'filled' ? rest.protection : null

    const outboxIds = await db.transaction(async (tx) => {
      const scope = await lockPrScope({ tx, repoFullName: args.repoFullName })
      await recordCommitChecks({
        tx: scope,
        repoFullName: args.repoFullName,
        headSha,
        checks,
      })
      const applied = await this.deps.store.applyWithin({
        tx: scope,
        repoFullName: args.repoFullName,
        prNumber: args.prNumber,
        observations: mergeabilityObservationsOf(fill),
        ...(protection === null ? {} : { protection }),
      })

      return applied.outboxIds
    })
    await this.deps.store.dispatch(outboxIds)

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

function mergeabilityObservationsOf(fill: FillFields | null): readonly PrObservation[] {
  if (fill === null || fill.headSha === '' || fill.baseBranch === '') return []
  const observedAt = fill.updatedAt.toISOString()

  return [
    {
      kind: 'mergeability',
      source: EPrSource.DeliveryFill,
      observedAt,
      sample: {
        headSha: fill.headSha,
        baseBranch: fill.baseBranch,
        mergeable: fill.mergeable,
        mergeClean: fill.mergeClean ?? null,
        observedAt,
      },
    },
  ]
}

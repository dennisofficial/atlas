import { EPrSource } from '@dltech/atlas-core'

import { EGithubCallSource } from './github-call-log'
import { normalizedRepo } from './github-pr-identity'
import { mergeabilityObservationOfSample, pullObservationOfRest } from './github-pr-observations'
import { applyObservedPull } from './github-pr-observed-pull'
import { GithubPrTokenUnavailable } from './github-pr-reconcile'
import type { GithubPrStore } from './github-pr-store'
import type { GithubUserReads } from './github-user-reads'
import { withGithubRequestBudget, type GithubHttpBudget } from './github-request-budget'

export class GithubPrMergeabilityPending extends Error {
  constructor(args: { repoFullName: string; prNumber: number }) {
    super(`GitHub has not computed mergeability for ${args.repoFullName}#${args.prNumber} yet`)
  }
}

export class GithubPrMergeabilityRefresh {
  constructor(
    private readonly deps: {
      store: () => GithubPrStore
      fillTokenOf: (args: {
        repoFullName: string
        installationId: bigint | undefined
      }) => Promise<string | undefined>
      reads: Pick<GithubUserReads, 'readPullRequestObservation'>
      budget: GithubHttpBudget
    },
  ) {}

  async run(args: { repoFullName: string; prNumber: number }): Promise<void> {
    const repoFullName = normalizedRepo(args.repoFullName)
    const token = await this.deps.fillTokenOf({ repoFullName, installationId: undefined })
    if (token === undefined) throw new GithubPrTokenUnavailable(repoFullName)
    const [owner, repo] = repoFullName.split('/') as [string, string]
    const read = await withGithubRequestBudget({
      store: this.deps.budget,
      run: () =>
        this.deps.reads.readPullRequestObservation({
          source: EGithubCallSource.DeliveryFill,
          token,
          owner,
          repo,
          number: args.prNumber,
        }),
    })
    const observation = pullObservationOfRest({
      repoFullName,
      pull: read.pull,
      updatedAt: read.pull.updated_at,
      observedAt: read.mergeability.observedAt,
      source: EPrSource.DeliveryFill,
    })
    if (observation === null) {
      throw new GithubPrMergeabilityPending({ repoFullName, prNumber: args.prNumber })
    }
    await applyObservedPull({
      store: this.deps.store(),
      repoFullName,
      prNumber: args.prNumber,
      observations: [
        observation,
        mergeabilityObservationOfSample({
          sample: read.mergeability,
          source: EPrSource.DeliveryFill,
        }),
      ],
      headSha: read.headSha,
      checks: read.checks,
      protection: read.protection,
    })
    if (read.mergeability.mergeable === null) {
      throw new GithubPrMergeabilityPending({ repoFullName, prNumber: args.prNumber })
    }
  }
}

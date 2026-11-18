import { db } from '@dltech/atlas-db'

import { EGithubCallSource } from './github-call-log'
import { lockCommit, recordCommitChecks } from './github-commit-checks'
import { affectedPrsBySha } from './github-delivery-affected'
import { normalizedRepo } from './github-pr-identity'
import type { GithubPrStore } from './github-pr-store'
import type { GithubUserReads } from './github-user-reads'
import { withGithubRequestBudget, type GithubHttpBudget } from './github-request-budget'

export type PrReconcileArgs = { repoFullName: string; headSha: string }

export class GithubPrReconcile {
  constructor(
    private readonly deps: {
      store: () => GithubPrStore
      fillTokenOf: (args: {
        repoFullName: string
        installationId: bigint | undefined
      }) => Promise<string | undefined>
      reads: Pick<GithubUserReads, 'readHeadChecksOf'>
      budget: GithubHttpBudget
    },
  ) {}

  async run(args: PrReconcileArgs): Promise<void> {
    const repoFullName = normalizedRepo(args.repoFullName)
    const token = await this.deps.fillTokenOf({ repoFullName, installationId: undefined })
    if (token === undefined) {
      throw new Error(`github reconcile has no installation token for ${repoFullName}`)
    }
    const [owner, repo] = repoFullName.split('/') as [string, string]
    const checks = await withGithubRequestBudget({
      store: this.deps.budget,
      run: () =>
        this.deps.reads.readHeadChecksOf({
          source: EGithubCallSource.ChecksState,
          token,
          owner,
          repo,
          headSha: args.headSha,
        }),
    })
    const affected = await db.transaction(async (tx) => {
      await lockCommit({ tx, repoFullName, headSha: args.headSha })
      await recordCommitChecks({ tx, repoFullName, headSha: args.headSha, checks })

      return affectedPrsBySha({ tx, repoFullName, sha: args.headSha })
    })
    for (const pr of affected) {
      await this.deps.store().apply({ repoFullName, prNumber: pr.prNumber, observations: [] })
    }
  }
}

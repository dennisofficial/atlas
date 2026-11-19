import { AsyncLocalStorage } from 'node:async_hooks'
import { db } from '@dltech/atlas-db'

import { EGithubCallSource } from './github-call-log'
import { recordCommitChecks } from './github-commit-checks'
import { affectedPrsBySha } from './github-delivery-affected'
import { normalizedRepo } from './github-pr-identity'
import { lockPrScope } from './github-pr-lock'
import type { GithubPrStore } from './github-pr-store'
import type { GithubUserReads } from './github-user-reads'
import { withGithubRequestBudget, type GithubHttpBudget } from './github-request-budget'

export type PrReconcileArgs = { repoFullName: string; headSha: string }

export class GithubPrTokenUnavailable extends Error {
  readonly parked = true
  constructor(repoFullName: string) {
    super(`github reconcile has no installation token for ${repoFullName}`)
  }
}

const inlineConfirmation = new AsyncLocalStorage<boolean>()

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
    if (token === undefined) throw new GithubPrTokenUnavailable(repoFullName)
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
    const applied = await db.transaction(async (tx) => {
      const scope = await lockPrScope({ tx, repoFullName })
      await recordCommitChecks({ tx: scope, repoFullName, headSha: args.headSha, checks })
      const affected = await affectedPrsBySha({ tx: scope, repoFullName, sha: args.headSha })
      const store = this.deps.store()
      const outboxIds: string[] = []
      for (const pr of affected) {
        const result = await store.applyWithin({
          tx: scope,
          repoFullName,
          prNumber: pr.prNumber,
          observations: [],
        })
        outboxIds.push(...result.outboxIds)
      }

      return { store, outboxIds }
    })
    if (inlineConfirmation.getStore() === true) return
    await inlineConfirmation.run(true, () => applied.store.dispatch(applied.outboxIds))
  }
}

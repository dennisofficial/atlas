import { db, type Row } from '@dltech/atlas-db'
import { dtoOf } from './github-delivery-routing'
import {
  nextVersionOf,
  readPrStateForUpdate,
  settlementSnapshotOf,
  snapshotOfLocked,
} from './github-pr-head-checks'
import { normalizedRepo } from './github-pr-identity'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { deliverPrTransitions } from './github-pr-transition-push'
import { isGithubBudgetParked } from './github-request-budget'
import type { GithubPrStateDto } from './github-realtime.types'
import type { GithubSubscribedPrResolver } from './github-subscribed-pr-resolver'

export class GithubSubscribeStateWriter {
  constructor(
    private readonly deps: {
      prs: GithubSubscribedPrResolver
      mailbox: GithubPrEventMailboxService
    },
  ) {}

  async pullOnSubscribe(args: {
    userId: string
    token: string
    owner: string
    repo: string
    repoFullName: string
    prNumber: number | null
    covered: boolean
  }): Promise<GithubPrStateDto | null> {
    if (args.prNumber === null) return null
    const prNumber = args.prNumber
    const held = await this.prState({ repoFullName: args.repoFullName, prNumber })
    if (args.covered && held !== null) return dtoOf(held)
    const fields = await this.deps.prs
      .readPullRequest({
        userId: args.userId,
        token: args.token,
        owner: args.owner,
        repo: args.repo,
        repoFullName: args.repoFullName,
        number: prNumber,
      })
      .catch((failure: unknown) => {
        if (isGithubBudgetParked(failure)) return null
        throw failure
      })
    if (fields === null) return held === null ? null : dtoOf(held)
    if (fields.headRepoFullName !== null)
      fields.headRepoFullName = normalizedRepo(fields.headRepoFullName)
    const row = await db.transaction(async (tx) => {
      const priorRow = await readPrStateForUpdate({ tx, repoFullName: args.repoFullName, prNumber })
      const row = await tx.orm.public.GithubPrState.upsert({
        conflictOn: { repoFullName: args.repoFullName, prNumber },
        create: {
          repoFullName: args.repoFullName,
          prNumber,
          ...fields,
          version: nextVersionOf(priorRow),
          updatedAt: new Date(),
        },
        update: { ...fields, version: nextVersionOf(priorRow), updatedAt: new Date() },
      })
      await deliverPrTransitions({
        writes: {
          mailbox: this.deps.mailbox,
          repoFullName: args.repoFullName,
          prNumber,
          url: row.url,
        },
        prior: priorRow === null ? null : snapshotOfLocked(priorRow),
        next: await settlementSnapshotOf({ tx, row }),
        userIds: [args.userId],
        tx,
      })
      return row
    })
    return dtoOf(row)
  }

  private prState(args: {
    repoFullName: string
    prNumber: number
  }): Promise<Row<'GithubPrState'> | null> {
    return db.orm.public.GithubPrState.where({
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
    }).first()
  }
}

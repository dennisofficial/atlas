import { db, type Row } from '@dltech/atlas-db'
import { EPrSource } from '@dltech/atlas-core'
import { dtoOf } from './github-delivery-routing'
import { mergeabilityObservationOfSample, pullObservationOfRest } from './github-pr-observations'
import { isGithubBudgetParked } from './github-request-budget'
import type { GithubPrStateDto } from './github-realtime.types'
import { applyObservedPull } from './github-pr-observed-pull'
import type { GithubPrStore } from './github-pr-store'
import type { GithubSubscribedPrResolver } from './github-subscribed-pr-resolver'
import { inWatchScope } from './github-watch-scope'

export class GithubSubscribeStateWriter {
  constructor(
    private readonly deps: {
      prs: GithubSubscribedPrResolver
      store: GithubPrStore
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
    const watchedBefore = await inWatchScope({
      repoFullName: args.repoFullName,
      prNumbers: [prNumber],
    })
    if (args.covered && held !== null && watchedBefore) return dtoOf(held)
    const read = await this.deps.prs
      .readPullRequestObservation({
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
    if (read === null) return held === null ? null : dtoOf(held)
    const observedAt = read.mergeability.observedAt
    const observation = pullObservationOfRest({
      repoFullName: args.repoFullName,
      pull: read.pull,
      updatedAt: read.pull.updated_at,
      observedAt,
      source: EPrSource.SubscribePull,
    })
    if (observation === null) return held === null ? null : dtoOf(held)
    const applied = await applyObservedPull({
      store: this.deps.store,
      repoFullName: args.repoFullName,
      prNumber,
      observations: [
        observation,
        mergeabilityObservationOfSample({
          sample: read.mergeability,
          source: EPrSource.SubscribePull,
        }),
      ],
      headSha: read.headSha,
      checks: read.checks,
      protection: read.protection,
      recipients: [args.userId],
    })
    if (!applied.applied || applied.row === null) return held === null ? null : dtoOf(held)

    return dtoOf(applied.row)
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

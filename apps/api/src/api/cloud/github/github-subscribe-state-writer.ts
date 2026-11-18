import { db, type Row } from '@dltech/atlas-db'
import { dtoOf } from './github-delivery-routing'
import { normalizedRepo } from './github-pr-identity'
import type { GithubPrStateWriter } from './github-pr-state-writer'
import { isGithubBudgetParked } from './github-request-budget'
import type { GithubPrStateDto } from './github-realtime.types'
import type { GithubSubscribedPrResolver } from './github-subscribed-pr-resolver'

export class GithubSubscribeStateWriter {
  constructor(
    private readonly deps: {
      prs: GithubSubscribedPrResolver
      writer: GithubPrStateWriter
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
    const { row } = await db.transaction((tx) =>
      this.deps.writer.writeState({
        tx,
        repoFullName: args.repoFullName,
        prNumber,
        fields: { ...fields, updatedAt: new Date() },
      }),
    )
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

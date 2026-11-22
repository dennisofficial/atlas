import { db } from '@dltech/atlas-db'
import { EGithubCallSource } from './github-call-log'
import { EGithubHttpStatus, GithubHttpError } from './github-http-error'
import { GithubRequestCoordinator } from './github-request-coordinator'
import {
  GithubUserReads,
  GithubUserReadFailed,
  type PullObservationRead,
} from './github-user-reads'

export class GithubSubscribedPrResolver {
  constructor(
    private readonly deps: {
      reads: GithubUserReads
      coordinator: GithubRequestCoordinator
    },
  ) {}

  async proveRead<T>(args: {
    userId: string
    repoFullName: string
    read: () => Promise<T>
  }): Promise<T> {
    try {
      const value = await args.read()
      await this.deps.coordinator.recordAccess({
        userId: args.userId,
        repoFullName: args.repoFullName,
      })
      return value
    } catch (failure) {
      if (
        failure instanceof GithubUserReadFailed &&
        (failure.status === 403 || failure.status === 404)
      )
        throw new GithubHttpError({
          status: EGithubHttpStatus.Forbidden,
          message: `no access to ${args.repoFullName}`,
        })
      throw failure
    }
  }

  readPullRequestObservation(args: {
    userId: string
    token: string
    repoFullName: string
    owner: string
    repo: string
    number: number
  }): Promise<PullObservationRead> {
    return this.proveRead({
      userId: args.userId,
      repoFullName: args.repoFullName,
      read: () =>
        this.deps.reads.readPullRequestObservation({
          source: EGithubCallSource.SubscriptionResolve,
          token: args.token,
          owner: args.owner,
          repo: args.repo,
          number: args.number,
        }),
    })
  }

  async resolvePrNumber(args: {
    userId: string
    token: string
    repoFullName: string
    owner: string
    repo: string
    prNumber?: number
    branch?: string
    threadId?: string
  }): Promise<number | null> {
    if (args.prNumber !== undefined) return args.prNumber
    const branch = args.branch
    if (branch === undefined) return null

    const remembered = await this.rememberedPr({ ...args, branch })
    if (remembered !== null && (await this.stillOpen({ ...args, prNumber: remembered }))) {
      return remembered
    }

    const found = await this.proveRead({
      userId: args.userId,
      repoFullName: args.repoFullName,
      read: () =>
        this.deps.reads.findOpenPrForBranch({
          source: EGithubCallSource.SubscriptionResolve,
          token: args.token,
          owner: args.owner,
          repo: args.repo,
          branch,
        }),
    })
    return found === null ? remembered : found.number
  }

  private async rememberedPr(args: {
    userId: string
    repoFullName: string
    branch: string
    threadId?: string
  }): Promise<number | null> {
    const held = await db.orm.public.GithubSubscription.where({
      userId: args.userId,
      repoFullName: args.repoFullName,
      branch: args.branch,
      threadId: args.threadId ?? '',
    }).first()
    return held === null ? null : held.prNumber
  }

  private async stillOpen(args: { repoFullName: string; prNumber: number }): Promise<boolean> {
    const state = await db.orm.public.GithubPrState.where({
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
    }).first()
    return state !== null && state.state === 'open'
  }
}

import { Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { db } from '../../../db'
import { dtoOf, subscriberWhereOf } from './github-delivery.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import type { GithubBranchRouting, GithubPrStateDto } from './github-realtime.types'
import { GithubUserReadFailed, GithubUserReads } from './github-user-reads'
import { GithubService } from './github.service'

const POLL_INTERVAL_MS = 30_000

@Injectable()
export class GithubPollSweeperService {
  private readonly logger = new Logger(GithubPollSweeperService.name)

  constructor(
    private readonly github: GithubService,
    private readonly reads: GithubUserReads,
    private readonly fanout: GithubPrFanoutService,
  ) {}

  @Interval(POLL_INTERVAL_MS)
  async handlePoll(): Promise<void> {
    const now = new Date()

    const repos = await db.githubRepoHook.findMany({ where: { idleSince: null } })
    for (const hook of repos) {
      const live = await db.githubSubscription.findMany({
        where: { repoFullName: hook.repoFullName, expiresAt: { gt: now } },
      })
      if (live.length === 0) {
        await db.githubRepoHook.updateMany({
          where: { repoFullName: hook.repoFullName, idleSince: null },
          data: { idleSince: now },
        })
      }
    }

    const pollBacked = await db.githubSubscription.findMany({
      where: { pollBacked: true, expiresAt: { gt: now } },
    })
    for (const subscription of pollBacked) {
      const prNumber = await this.resolvePrNumber({
        subscriptionId: subscription.id,
        userId: subscription.userId,
        repoFullName: subscription.repoFullName,
        prNumber: subscription.prNumber,
        branch: subscription.branch,
      })
      if (prNumber === null) continue
      await this.pollOne({
        userId: subscription.userId,
        repoFullName: subscription.repoFullName,
        prNumber,
      })
    }
  }

  private async resolvePrNumber(args: {
    subscriptionId: string
    userId: string
    repoFullName: string
    prNumber: number | null
    branch: string
  }): Promise<number | null> {
    if (args.prNumber !== null || args.branch === '') return args.prNumber

    const token = await this.github.findToken({ userId: args.userId })
    if (token === undefined) return null

    const [owner, repo] = args.repoFullName.split('/') as [string, string]
    let found: { number: number } | null
    try {
      found = await this.reads.findOpenPrForBranch({ token, owner, repo, branch: args.branch })
    } catch (failure) {
      if (failure instanceof GithubUserReadFailed) return null
      throw failure
    }
    if (found === null) return null

    await db.githubSubscription.update({
      where: { id: args.subscriptionId },
      data: { prNumber: found.number },
    })
    return found.number
  }

  private async pollOne(args: {
    userId: string
    repoFullName: string
    prNumber: number
  }): Promise<void> {
    const token = await this.github.findToken({ userId: args.userId })
    if (token === undefined) return

    const [owner, repo] = args.repoFullName.split('/') as [string, string]
    let pushed: { state: GithubPrStateDto; routing: GithubBranchRouting }
    try {
      const fields = await this.reads.readPullRequest({
        token,
        owner,
        repo,
        number: args.prNumber,
      })
      const row = await db.githubPrState.upsert({
        where: {
          repoFullName_prNumber: { repoFullName: args.repoFullName, prNumber: args.prNumber },
        },
        create: {
          repoFullName: args.repoFullName,
          prNumber: args.prNumber,
          ...fields,
          updatedAt: new Date(),
        },
        update: { ...fields, updatedAt: new Date() },
      })
      pushed = {
        state: dtoOf(row),
        routing: {
          headBranch: fields.headBranch,
          headRepoMatchesBase: fields.headRepoFullName === args.repoFullName,
        },
      }
    } catch (failure) {
      if (failure instanceof GithubUserReadFailed) return
      throw failure
    }

    const subscribers = await db.githubSubscription.findMany({
      where: subscriberWhereOf({
        repoFullName: args.repoFullName,
        prNumber: args.prNumber,
        routing: pushed.routing,
      }),
    })
    if (subscribers.length > 0) {
      this.fanout.push({
        userIds: [...new Set(subscribers.map((subscriber) => subscriber.userId))],
        state: pushed.state,
      })
    }
  }
}

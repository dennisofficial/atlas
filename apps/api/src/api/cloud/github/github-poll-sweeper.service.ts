import { Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { db } from '../../../db'
import { dtoOf } from './github-delivery.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import type { GithubPrStateDto } from './github-realtime.types'
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
      await this.pollOne({
        subscriptionId: subscription.id,
        userId: subscription.userId,
        repoFullName: subscription.repoFullName,
        prNumber: subscription.prNumber,
      })
    }
  }

  private async pollOne(args: {
    subscriptionId: string
    userId: string
    repoFullName: string
    prNumber: number
  }): Promise<void> {
    const token = await this.github.findToken({ userId: args.userId })
    if (token === undefined) return

    const [owner, repo] = args.repoFullName.split('/') as [string, string]
    let state: GithubPrStateDto
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
      state = dtoOf(row)
    } catch (failure) {
      if (failure instanceof GithubUserReadFailed) return
      throw failure
    }

    const subscribers = await db.githubSubscription.findMany({
      where: {
        repoFullName: args.repoFullName,
        prNumber: args.prNumber,
        expiresAt: { gt: new Date() },
      },
    })
    if (subscribers.length > 0) {
      this.fanout.push({ userIds: subscribers.map((row) => row.userId), state })
    }
  }
}

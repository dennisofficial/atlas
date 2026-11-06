import type { Logger } from '@nestjs/common'
import { db, type Row, type Tx } from '@dltech/atlas-db'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { announceSubscriberThreads } from './github-list-signals'
import { GithubObservationStore } from './github-observation.store'
import { normalizedRepo } from './github-pr-identity'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { nextVersionOf, readPrStateForUpdate, snapshotOfLocked } from './github-pr-head-checks'
import { deliverPrTransitions } from './github-pr-transition-push'
import { branchRoutingOf, dtoOf, subscriberWhereOf } from './github-delivery-routing'
import type { GithubPrStateRecord } from './github-realtime.types'

export type PrStateWrite = { row: Row<'GithubPrState'>; userIds: string[] }

export class GithubPrStateWriter {
  constructor(
    private readonly deps: {
      mailbox: GithubPrEventMailboxService
      fanout: GithubPrFanoutService
      signals: ThreadSignalsService
      observations: GithubObservationStore
      logger: Logger
    },
  ) {}

  /**
   * One transaction per observation: the locked state row is the prior, the upsert and the
   * dedupe-keyed event rows commit together, so a crash between the state write and event
   * creation no longer consumes a boundary — the retry replays the same observation and its
   * dedupe keys make the event inserts idempotent.
   */
  async writeState(args: {
    tx: Tx
    repoFullName: string
    prNumber: number
    fields: GithubPrStateRecord
  }): Promise<PrStateWrite> {
    const { tx } = args
    const repoFullName = normalizedRepo(args.repoFullName)
    const fields = {
      ...args.fields,
      headRepoFullName:
        args.fields.headRepoFullName === null ? null : normalizedRepo(args.fields.headRepoFullName),
    }

    const priorRow = await readPrStateForUpdate({
      tx,
      repoFullName,
      prNumber: args.prNumber,
    })
    const prior = priorRow === null ? null : snapshotOfLocked(priorRow)
    const headBranch = fields.headBranch ?? priorRow?.headBranch
    const headRepoFullName = fields.headRepoFullName ?? priorRow?.headRepoFullName ?? null
    const version = nextVersionOf(priorRow)
    const row = await tx.orm.public.GithubPrState.upsert({
      conflictOn: { repoFullName, prNumber: args.prNumber },
      create: { repoFullName, prNumber: args.prNumber, ...fields, version },
      update: { ...fields, version },
    })

    const subscribers = await tx.orm.public.GithubSubscription.where(
      subscriberWhereOf({
        repoFullName,
        prNumber: args.prNumber,
        routing: branchRoutingOf({
          baseRepoFullName: repoFullName,
          headBranch: headBranch ?? '',
          headRepoFullName,
        }),
      }),
    ).all()
    const userIds = [...new Set(subscribers.map((subscriber) => subscriber.userId))]
    await deliverPrTransitions({
      writes: {
        mailbox: this.deps.mailbox,
        repoFullName,
        prNumber: args.prNumber,
        url: row.url,
      },
      prior,
      next: snapshotOfLocked(row),
      userIds,
      tx,
    })
    return { row, userIds }
  }

  async recordAndPush(args: {
    repoFullName: string
    prNumber: number
    fields: GithubPrStateRecord
  }): Promise<void> {
    const write = await db.transaction((tx) => this.writeState({ tx, ...args }))
    await this.publish(write)
  }

  async publish(write: PrStateWrite): Promise<void> {
    const { row, userIds } = write
    const repoFullName = normalizedRepo(row.repoFullName)
    const prNumber = row.prNumber
    const observers = await this.deps.observations
      .owners({ repoFullName, prNumber })
      .catch((failure: unknown) => {
        this.deps.logger.warn(`observational PR routing unavailable: ${String(failure)}`)
        return []
      })
    const stateUserIds = [...new Set([...userIds, ...observers])]
    if (stateUserIds.length > 0) this.deps.fanout.push({ userIds: stateUserIds, state: dtoOf(row) })
    if (userIds.length === 0) return
    const subscribers = await db.orm.public.GithubSubscription.where(
      subscriberWhereOf({
        repoFullName,
        prNumber,
        routing: branchRoutingOf({
          baseRepoFullName: repoFullName,
          headBranch: row.headBranch,
          headRepoFullName: row.headRepoFullName,
        }),
      }),
    ).all()
    await announceSubscriberThreads({
      signals: this.deps.signals,
      subscribers,
    })
  }
}

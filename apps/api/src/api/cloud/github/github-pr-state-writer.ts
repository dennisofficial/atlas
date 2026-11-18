import type { Logger } from '@nestjs/common'
import { announceSessionChangesIn, sessionsTrackingHeadIn } from '@dltech/atlas-control/postgres'
import { db, type Row, type Tx } from '@dltech/atlas-db'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import { announceSubscriberThreads } from './github-list-signals'
import { normalizedRepo } from './github-pr-identity'
import { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import {
  type LockedPrState,
  nextVersionOf,
  readPrStateForUpdate,
  settlementSnapshotOf,
  snapshotOfLocked,
} from './github-pr-head-checks'
import { deliverPrTransitions } from './github-pr-transition-push'
import { branchRoutingOf, dtoOf, subscriberWhereOf } from './github-delivery-routing'
import type { GithubPrStateRecord } from './github-realtime.types'

export type PrStateWrite = { row: Row<'GithubPrState'>; userIds: string[] }

const TERMINAL_STATES = new Set(['merged', 'closed'])

export function fillSuperseded(args: {
  seenVersion: number | undefined
  seenHeadSha: string | undefined
  storedVersion: number
  storedHeadSha: string | null
}): boolean {
  if (args.seenVersion !== undefined) return args.seenVersion !== args.storedVersion
  if (args.seenHeadSha === undefined || args.storedHeadSha === null) return false
  return args.seenHeadSha !== args.storedHeadSha
}

export function terminalStateKept(args: {
  prior: LockedPrState | null
  next: string
  reopens: boolean
}): string | null {
  if (args.prior === null || args.reopens) return null
  if (!TERMINAL_STATES.has(args.prior.state)) return null
  return TERMINAL_STATES.has(args.next) ? null : args.prior.state
}

/**
 * GitHub's rollup state is display data with no second source, so a fill whose GraphQL read failed
 * (null) keeps the stored value while the head is unchanged, and a new head resets it.
 */
export function checksStateKept(args: {
  prior: { headSha: string; checksState: string | null } | null
  next: GithubPrStateRecord
}): string | null {
  if (args.next.checksState !== null) return args.next.checksState
  if (args.prior === null || args.prior.headSha !== args.next.headSha) return null
  return args.prior.checksState
}

export class GithubPrStateWriter {
  constructor(
    private readonly deps: {
      mailbox: GithubPrEventMailboxService
      fanout: GithubPrFanoutService
      signals: ThreadSignalsService
      logger: Logger
    },
  ) {}

  async writeState(args: {
    tx: Tx
    repoFullName: string
    prNumber: number
    fields: GithubPrStateRecord
    reopens?: boolean
    authoritative?: boolean
    seenVersion?: number | undefined
    seenHeadSha?: string | undefined
    recipients?: readonly string[]
  }): Promise<PrStateWrite | null> {
    const { tx } = args
    const repoFullName = normalizedRepo(args.repoFullName)
    const locked = await readPrStateForUpdate({
      tx,
      repoFullName,
      prNumber: args.prNumber,
    })
    if (
      fillSuperseded({
        seenVersion: args.seenVersion,
        seenHeadSha: args.seenHeadSha,
        storedVersion: locked?.version ?? 0,
        storedHeadSha: locked?.headSha ?? null,
      })
    )
      return null
    const keptState = terminalStateKept({
      prior: locked,
      next: args.fields.state,
      reopens: args.reopens === true || args.authoritative === true,
    })
    const fields = {
      ...args.fields,
      state: keptState ?? args.fields.state,
      checksState: checksStateKept({ prior: locked, next: args.fields }),
      headRepoFullName:
        args.fields.headRepoFullName === null ? null : normalizedRepo(args.fields.headRepoFullName),
    }

    const priorRow = locked
    const prior = priorRow === null ? null : snapshotOfLocked(priorRow)
    const headBranch = fields.headBranch ?? priorRow?.headBranch
    const headRepoFullName = fields.headRepoFullName ?? priorRow?.headRepoFullName ?? null
    const version = nextVersionOf(priorRow)
    const row = await tx.orm.public.GithubPrState.upsert({
      conflictOn: { repoFullName, prNumber: args.prNumber },
      create: { repoFullName, prNumber: args.prNumber, ...fields, version },
      update: { ...fields, version },
    })

    if (headRepoFullName !== null)
      await announceSessionChangesIn({
        tx,
        sessionIds: await sessionsTrackingHeadIn({
          tx,
          headRepo: headRepoFullName,
          branch: headBranch ?? row.headBranch,
        }),
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
    const userIds = [
      ...new Set([
        ...(args.recipients ?? []),
        ...subscribers.map((subscriber) => subscriber.userId),
      ]),
    ]
    await deliverPrTransitions({
      writes: {
        mailbox: this.deps.mailbox,
        repoFullName,
        prNumber: args.prNumber,
        url: row.url,
      },
      prior,
      next: await settlementSnapshotOf({ tx, row }),
      userIds,
      tx,
    })
    return { row, userIds }
  }

  async recordAndPush(args: {
    repoFullName: string
    prNumber: number
    fields: GithubPrStateRecord
    reopens?: boolean
    seenVersion?: number
  }): Promise<PrStateWrite | null> {
    const write = await db.transaction((tx) => this.writeState({ tx, ...args }))
    if (write !== null) await this.publish(write)
    return write
  }

  async publish(write: PrStateWrite): Promise<void> {
    const { row, userIds } = write
    const repoFullName = normalizedRepo(row.repoFullName)
    const prNumber = row.prNumber
    this.deps.fanout.push({ userIds, state: dtoOf(row) })
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

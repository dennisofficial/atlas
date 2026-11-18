import {
  foldPrObservations,
  provenanceAdvancedBetween,
  withDerivedChecks,
  type PrFoldChange,
  type PrObservation,
} from '@dltech/atlas-core'
import { db, type Row, type Tx } from '@dltech/atlas-db'

import { branchRoutingOf, dtoOf, subscriberWhereOf } from './github-delivery-routing'
import type { BranchProtectionRead } from './github-branch-protection'
import { rememberBranchProtection } from './github-branch-protection'
import type { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { normalizedRepo } from './github-pr-identity'
import { lockPrScope, type PrScopeTx } from './github-pr-lock'
import {
  GithubPrOutboxDispatcher,
  GithubPrOutboxWriter,
  PrEffectCollector,
  type PrOutboxEffect,
} from './github-pr-outbox'
import { settlementSnapshotOf, snapshotOfLocked } from './github-pr-head-checks'
import { reconcileOutboxEffectsOf } from './github-pr-reconcile-effects'
import { foldStateOfRow, headChecksOf } from './github-pr-row-fold'
import { writePrProvenance, writePrStateRow } from './github-pr-state-row-write'
import { deliverPrTransitions } from './github-pr-transition-push'

export type PrApplyArgs = {
  repoFullName: string
  prNumber: number
  observations: readonly PrObservation[]
  recipients?: readonly string[]
  protection?: BranchProtectionRead
}

export type PrApplyResult = {
  applied: boolean
  row: Row<'GithubPrState'> | null
  changed: readonly PrFoldChange[]
}

type PrApplyWrite = PrApplyResult & { outboxIds: readonly string[] }

export class GithubPrStore {
  constructor(
    private readonly deps: {
      mailbox: GithubPrEventMailboxService
      dispatcher: GithubPrOutboxDispatcher
    },
  ) {}

  async apply(args: PrApplyArgs): Promise<PrApplyResult> {
    const write = await db.transaction((tx) =>
      this.writeWithin({ ...args, tx, repoFullName: normalizedRepo(args.repoFullName) }),
    )
    await this.deps.dispatcher.dispatch(write.outboxIds)

    return { applied: write.applied, row: write.row, changed: write.changed }
  }

  private async writeWithin(
    args: PrApplyArgs & { tx: Tx; repoFullName: string },
  ): Promise<PrApplyWrite> {
    const tx = await lockPrScope({ tx: args.tx, repoFullName: args.repoFullName })
    if (args.protection !== undefined) {
      await rememberBranchProtection({
        tx,
        repoFullName: args.repoFullName,
        protection: args.protection,
      })
    }
    const stored = await tx.orm.public.GithubPrState.where({
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
    }).first()
    const storedState = foldStateOfRow(stored)
    const folded = foldPrObservations({
      state: storedState,
      observations: args.observations,
    })
    if (folded.state === null || folded.state.pull === null) {
      return { applied: false, row: stored, changed: [], outboxIds: [] }
    }
    const { headSha, baseBranch } = folded.state.pull
    const head = await headChecksOf({ tx, repoFullName: args.repoFullName, headSha, baseBranch })
    const checked = withDerivedChecks({ derived: head.derived, state: folded.state })
    const state = checked.state
    if (state === null) return { applied: false, row: stored, changed: [], outboxIds: [] }
    const rechecks = reconcileOutboxEffectsOf({
      attempts: head.identities,
      repoFullName: args.repoFullName,
      headSha,
    })
    const checksStateMoved = (stored?.checksState ?? null) !== head.checksState
    const changed: PrFoldChange[] = [
      ...new Set<PrFoldChange>([
        ...folded.changed,
        ...checked.changed,
        ...(checksStateMoved ? (['checks'] as const) : []),
      ]),
    ]
    if (changed.length === 0) {
      if (!provenanceAdvancedBetween({ from: storedState, to: state })) {
        return { applied: false, row: stored, changed: [], outboxIds: [] }
      }
      const row = await writePrProvenance({ ...args, tx, state })

      return { applied: false, row: row ?? stored, changed: [], outboxIds: [] }
    }

    const row = await writePrStateRow({
      ...args,
      tx,
      state,
      checksState: head.checksState,
      stored,
    })
    const subscribers = await this.subscribersOf({ ...args, tx, row })
    const effects = new PrEffectCollector()
    await deliverPrTransitions({
      writes: {
        mailbox: this.deps.mailbox,
        repoFullName: args.repoFullName,
        prNumber: args.prNumber,
        url: row.url,
        within: { tx, effects },
      },
      prior: stored === null ? null : snapshotOfLocked(stored),
      next: settlementSnapshotOf({ row, missingRequiredChecks: head.missingRequiredContexts }),
      userIds: this.recipientsOf({ ...args, subscribers }),
      tx,
    })
    const outboxIds = await GithubPrOutboxWriter.write({
      tx,
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
      effects: this.outboxEffectsOf({ args, row, subscribers, effects, rechecks }),
    })

    return { applied: true, row, changed, outboxIds }
  }

  private recipientsOf(args: {
    recipients?: readonly string[] | undefined
    subscribers: readonly Row<'GithubSubscription'>[]
  }): string[] {
    return [
      ...new Set([...(args.recipients ?? []), ...args.subscribers.map((held) => held.userId)]),
    ]
  }

  private async subscribersOf(args: {
    tx: PrScopeTx
    repoFullName: string
    prNumber: number
    row: Row<'GithubPrState'>
  }): Promise<Row<'GithubSubscription'>[]> {
    return await args.tx.orm.public.GithubSubscription.where(
      subscriberWhereOf({
        repoFullName: args.repoFullName,
        prNumber: args.prNumber,
        routing: branchRoutingOf({
          baseRepoFullName: args.repoFullName,
          headBranch: args.row.headBranch,
          headRepoFullName: args.row.headRepoFullName,
        }),
      }),
    ).all()
  }

  private outboxEffectsOf(args: {
    args: PrApplyArgs & { repoFullName: string }
    row: Row<'GithubPrState'>
    subscribers: readonly Row<'GithubSubscription'>[]
    effects: PrEffectCollector
    rechecks: readonly PrOutboxEffect[]
  }): readonly PrOutboxEffect[] {
    const frame = `${args.args.repoFullName}#${args.args.prNumber}:${args.row.version}`
    const threads = [...new Set(args.subscribers.map((held) => held.threadId))].filter(
      (threadId) => threadId !== '',
    )

    return [
      {
        kind: 'fanout',
        payload: {
          userIds: this.recipientsOf({ ...args.args, subscribers: args.subscribers }),
          state: dtoOf(args.row),
        },
        dedupeKey: `fanout:${frame}`,
      },
      ...threads.map((threadId) => ({
        kind: 'thread-signal' as const,
        payload: { threadId },
        dedupeKey: `thread-signal:${frame}:${threadId}`,
      })),
      ...args.effects.all(),
      ...args.rechecks,
    ]
  }
}

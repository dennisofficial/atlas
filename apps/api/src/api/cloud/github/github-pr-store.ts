import {
  foldPrObservations,
  provenanceAdvancedBetween,
  withDerivedChecks,
  type ChecksCount,
  type PrFoldChange,
  type PrObservation,
} from '@dltech/atlas-core'
import { db, type Row } from '@dltech/atlas-db'

import { branchRoutingOf, dtoOf, subscriberWhereOf } from './github-delivery-routing'
import type { BranchProtectionRead } from './github-branch-protection'
import { rememberBranchProtection } from './github-branch-protection'
import {
  commitChecksTallyOf,
  readCommitChecks,
  recordCommitChecks,
  type CommitCheckInput,
} from './github-commit-checks'
import { affectedPrsBySha } from './github-delivery-affected'
import type { GithubPrEventMailboxService } from './github-pr-event-mailbox.service'
import { mergeFlagsOf, writePrFlags, type PrMergeFlags } from './github-pr-flags'
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
import { foldStateOfRow, headChecksOf, type CheckIdentityRow } from './github-pr-row-fold'
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

export type PrScopeApplyResult = PrApplyResult & { outboxIds: readonly string[] }

export type PrChecksApplyResult = {
  tally: ChecksCount
  awaitingSettle: readonly number[]
  outboxIds: readonly string[]
}

async function settlesSoon(args: {
  tx: PrScopeTx
  tally: ChecksCount
  pr: { repoFullName: string; prNumber: number }
  headSha: string
}): Promise<boolean> {
  if (args.tally.running > 0) return false
  if (args.tally.passed + args.tally.failed + args.tally.ignored === 0) return false
  const ledger = await args.tx.orm.public.GithubPrHeadCheck.where({
    repoFullName: args.pr.repoFullName,
    prNumber: args.pr.prNumber,
    headSha: args.headSha,
  }).first()

  return ledger?.settledAt == null
}

export class GithubPrStore {
  constructor(
    private readonly deps: {
      mailbox: GithubPrEventMailboxService
      dispatcher: GithubPrOutboxDispatcher
    },
  ) {}

  async apply(args: PrApplyArgs): Promise<PrApplyResult> {
    const write = await db.transaction(async (tx) =>
      this.applyWithin({
        ...args,
        tx: await lockPrScope({ tx, repoFullName: normalizedRepo(args.repoFullName) }),
      }),
    )
    await this.dispatch(write.outboxIds)

    return { applied: write.applied, row: write.row, changed: write.changed }
  }

  async applyWithin(args: PrApplyArgs & { tx: PrScopeTx }): Promise<PrScopeApplyResult> {
    return await this.writeWithin({ ...args, repoFullName: normalizedRepo(args.repoFullName) })
  }

  async dispatch(outboxIds: readonly string[]): Promise<void> {
    await this.deps.dispatcher.dispatch(outboxIds)
  }

  /**
   * A merge-queue move or an auto-merge toggle changes no folded pull field, so it writes the
   * column and fans the new version out through the same state frame as any other change.
   */
  async applyMergeFlags(args: {
    repoFullName: string
    prNumber: number
    flags: Partial<PrMergeFlags>
  }): Promise<void> {
    const repoFullName = normalizedRepo(args.repoFullName)
    const outboxIds = await db.transaction(async (tx) => {
      const scope = await lockPrScope({ tx, repoFullName })
      const row = await writePrFlags({
        tx: scope,
        repoFullName,
        prNumber: args.prNumber,
        flags: args.flags,
      })
      if (row === null) return []
      const subscribers = await this.subscribersOf({
        tx: scope,
        repoFullName,
        prNumber: args.prNumber,
        row,
      })
      const frame = `${repoFullName}#${args.prNumber}:${row.version}`
      const threads = [...new Set(subscribers.map((held) => held.threadId))].filter(
        (threadId) => threadId !== '',
      )
      return await GithubPrOutboxWriter.write({
        tx: scope,
        repoFullName,
        prNumber: args.prNumber,
        effects: [
          {
            kind: 'fanout',
            payload: {
              userIds: [...new Set(subscribers.map((held) => held.userId))],
              state: dtoOf(row),
            },
            dedupeKey: `fanout:${frame}`,
          },
          ...threads.map((threadId) => ({
            kind: 'thread-signal' as const,
            payload: { threadId },
            dedupeKey: `thread-signal:${frame}:${threadId}`,
          })),
        ],
      })
    })
    await this.dispatch(outboxIds)
  }

  async applyChecks(args: {
    repoFullName: string
    headSha: string
    checks: readonly CommitCheckInput[]
  }): Promise<PrChecksApplyResult> {
    const repoFullName = normalizedRepo(args.repoFullName)
    const write = await db.transaction(async (tx) => {
      const scope = await lockPrScope({ tx, repoFullName })
      const held = await readCommitChecks({ tx: scope, repoFullName, headSha: args.headSha })
      const recorded = await recordCommitChecks({
        tx: scope,
        repoFullName,
        headSha: args.headSha,
        checks: args.checks,
        held,
      })
      const tally = commitChecksTallyOf(recorded)
      const affected = await affectedPrsBySha({ tx: scope, repoFullName, sha: args.headSha })
      const outboxIds: string[] = []
      const awaitingSettle: number[] = []
      for (const pr of affected) {
        if (await settlesSoon({ tx: scope, tally, pr, headSha: args.headSha })) {
          awaitingSettle.push(pr.prNumber)
          continue
        }
        const applied = await this.writeWithin({
          tx: scope,
          repoFullName,
          prNumber: pr.prNumber,
          observations: [],
          commitChecks: { headSha: args.headSha, rows: recorded },
        })
        outboxIds.push(...applied.outboxIds)
      }
      return { tally, awaitingSettle, outboxIds }
    })
    await this.dispatch(write.outboxIds)

    return write
  }

  private async writeWithin(
    args: PrApplyArgs & {
      tx: PrScopeTx
      repoFullName: string
      commitChecks?: { headSha: string; rows: readonly CheckIdentityRow[] }
    },
  ): Promise<PrScopeApplyResult> {
    const tx = args.tx
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
    const head = await headChecksOf({
      tx,
      repoFullName: args.repoFullName,
      headSha,
      baseBranch,
      commitChecks: args.commitChecks?.headSha === headSha ? args.commitChecks.rows : undefined,
    })
    const checked = withDerivedChecks({ derived: head.derived, state: folded.state })
    const state = checked.state
    if (state === null) return { applied: false, row: stored, changed: [], outboxIds: [] }
    const rechecks = reconcileOutboxEffectsOf({
      attempts: head.identities,
      repoFullName: args.repoFullName,
      headSha,
    })
    const checksStateMoved =
      (stored?.checksState ?? null) !== head.checksState ||
      (stored?.checksExpected ?? 0) !== head.missingRequiredContexts
    const changed: PrFoldChange[] = [
      ...new Set<PrFoldChange>([
        ...folded.changed,
        ...checked.changed,
        ...(checksStateMoved ? (['checks'] as const) : []),
      ]),
    ]
    if (changed.length === 0) {
      const outboxIds = await this.writeRechecks({ tx, args, rechecks })
      if (!provenanceAdvancedBetween({ from: storedState, to: state })) {
        return { applied: false, row: stored, changed: [], outboxIds }
      }
      const row = await writePrProvenance({ ...args, tx, state })

      return { applied: false, row: row ?? stored, changed: [], outboxIds }
    }

    const row = await writePrStateRow({
      ...args,
      tx,
      state,
      checksState: head.checksState,
      checksExpected: head.missingRequiredContexts,
      ...mergeFlagsOf({ stored, state }),
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

  private async writeRechecks(args: {
    tx: PrScopeTx
    args: PrApplyArgs & { repoFullName: string }
    rechecks: readonly PrOutboxEffect[]
  }): Promise<readonly string[]> {
    return await GithubPrOutboxWriter.write({
      tx: args.tx,
      repoFullName: args.args.repoFullName,
      prNumber: args.args.prNumber,
      effects: args.rechecks,
    })
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

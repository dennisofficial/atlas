import { randomUUID } from 'node:crypto'
import { Logger } from '@nestjs/common'
import { db, type Row, type Tx } from '@dltech/atlas-db'

import type { GithubPrFanoutService } from './github-pr-fanout.service'
import {
  claimPrOutboxRows,
  completePrOutboxRows,
  holdsPrOutboxLease,
  type PrOutboxClaim,
  type PrOutboxKindScope,
} from './github-pr-outbox-lease'
import { failPrOutboxRow } from './github-pr-outbox-failure'
import {
  type GithubLegacyEffects,
  type GithubWakeEventNotice,
  type GithubWakePrEvent,
  LEGACY_OUTBOX_KINDS,
} from './github-legacy-effects'
import { noticeV2Sessions } from './github-v2-notice'
import type { GithubPrEventDto, GithubPrStateDto } from './github-realtime.types'

export const PR_OUTBOX_BATCH = 32
export const PR_OUTBOX_DRAIN_BATCHES = 8
export const PR_OUTBOX_RETENTION_MS = 24 * 60 * 60 * 1_000

export type PrOutboxLogger = { warn(message: string): void }

type OutboxPayload = Row<'GithubPrOutbox'>['payload']
type WakePayload = { notice: GithubWakeEventNotice; event: GithubWakePrEvent }
type FanoutPayload =
  | { userIds: readonly string[]; state: GithubPrStateDto }
  | { userIds: readonly string[]; event: GithubPrEventDto; ackId: string }

export type PrOutboxWithin = { tx: Tx; effects: PrEffectCollector }

export type PrOutboxEffect =
  | { kind: 'fanout'; payload: FanoutPayload; dedupeKey: string }
  | { kind: 'thread-signal'; payload: { threadId: string }; dedupeKey: string }
  | { kind: 'wake'; payload: WakePayload; dedupeKey: string }
  | { kind: 'v2-notice'; payload: { eventId: string }; dedupeKey: string }
  | {
      kind: 'reconcile-checks'
      payload: { repoFullName: string; headSha: string }
      dedupeKey: string
    }
  | {
      kind: 'mergeability-refresh'
      payload: { repoFullName: string; prNumber: number }
      dedupeKey: string
    }

export type PrReconcileRun = (args: { repoFullName: string; headSha: string }) => Promise<void>

export type PrMergeabilityRun = (args: { repoFullName: string; prNumber: number }) => Promise<void>

export class PrEffectCollector {
  private readonly effects: PrOutboxEffect[] = []

  add(effect: PrOutboxEffect): void {
    this.effects.push(effect)
  }

  all(): readonly PrOutboxEffect[] {
    return this.effects
  }
}

export class GithubPrOutboxWriter {
  static async write(args: {
    tx: Tx
    repoFullName: string
    prNumber: number
    effects: readonly PrOutboxEffect[]
  }): Promise<readonly string[]> {
    if (args.effects.length === 0) return []
    const rows = args.effects.map((effect) => ({ id: `out_${randomUUID()}`, effect }))
    await args.tx.orm.public.GithubPrOutbox.createAndCount(
      rows.map(({ id, effect }) => ({
        id,
        kind: effect.kind,
        repoFullName: args.repoFullName,
        prNumber: args.prNumber,
        payload: effect.payload as OutboxPayload,
        dedupeKey: effect.dedupeKey,
        dispatchedAt: null,
        attempts: 0,
        lastError: null,
      })),
      { onConflict: 'skip' },
    )

    return rows.map((row) => row.id)
  }
}

export class GithubPrOutboxDispatcher {
  private readonly logger: PrOutboxLogger
  private readonly now: () => Date

  constructor(
    private readonly deps: {
      fanout: Pick<GithubPrFanoutService, 'push' | 'pushEvent'>
      legacy?: GithubLegacyEffects
      reconcile: PrReconcileRun
      mergeability: PrMergeabilityRun
      logger?: PrOutboxLogger
      now?: () => Date
    },
  ) {
    this.logger = deps.logger ?? new Logger(GithubPrOutboxDispatcher.name)
    this.now = deps.now ?? (() => new Date())
  }

  async dispatch(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    await this.runClaim(
      await claimPrOutboxRows({ now: this.now(), limit: ids.length, ids, ...this.kindScope() }),
    )
  }

  drain(): Promise<number> {
    return this.drainScoped(this.kindScope())
  }

  drainLegacy(): Promise<number> {
    if (this.deps.legacy === undefined) {
      throw new Error('the pr outbox cannot drain v1 effects without the legacy effects port')
    }
    return this.drainScoped({ onlyKinds: LEGACY_OUTBOX_KINDS })
  }

  private kindScope(): PrOutboxKindScope {
    return this.deps.legacy === undefined ? { excludeKinds: LEGACY_OUTBOX_KINDS } : {}
  }

  private async drainScoped(scope: PrOutboxKindScope): Promise<number> {
    let ran = 0
    for (let batch = 0; batch < PR_OUTBOX_DRAIN_BATCHES; batch += 1) {
      const claimed = await claimPrOutboxRows({
        now: this.now(),
        limit: PR_OUTBOX_BATCH,
        ...scope,
      })
      if (claimed.rows.length === 0 && claimed.deadLettered.length === 0) break
      ran += claimed.rows.length
      await this.runClaim(claimed)
    }

    return ran
  }

  private async runClaim(claimed: PrOutboxClaim): Promise<void> {
    for (const row of claimed.deadLettered) {
      this.logger.warn(
        `github pr outbox ${row.kind} ${row.id} dead-lettered after ${row.attempts} attempts: ${row.lastError ?? 'no error recorded'}`,
      )
    }
    const completed: string[] = []
    for (const row of claimed.rows) {
      if (await this.run({ row, token: claimed.token, leaseUntil: claimed.leaseUntil })) {
        completed.push(row.id)
      }
    }
    await this.complete({ ids: completed, token: claimed.token })
  }

  private async complete(args: { ids: readonly string[]; token: string }): Promise<void> {
    if (args.ids.length === 0) return
    const completed = await completePrOutboxRows({
      ids: args.ids,
      token: args.token,
      now: this.now(),
    })
    if (completed < args.ids.length) {
      this.logger.warn(
        `github pr outbox lost the claim on ${args.ids.length - completed} of ${args.ids.length} rows before their effects finished; they will run again`,
      )
    }
  }

  prune(args: { now: Date }): Promise<number> {
    return db.orm.public.GithubPrOutbox.where((row) =>
      row.dispatchedAt.lt(new Date(args.now.getTime() - PR_OUTBOX_RETENTION_MS)),
    ).deleteAndCount()
  }

  private async run(args: {
    row: Row<'GithubPrOutbox'>
    token: string
    leaseUntil: Date
  }): Promise<boolean> {
    const { row, token } = args
    const now = this.now()
    if (!(await holdsPrOutboxLease({ id: row.id, token, leaseUntil: args.leaseUntil, now }))) {
      this.logger.warn(
        `github pr outbox ${row.kind} ${row.id} was reclaimed before its effect ran; its new owner will run it`,
      )
      return false
    }
    try {
      await this.perform(row)
    } catch (failure) {
      const record = await failPrOutboxRow({ row, token, failure, now: this.now() })
      this.logger.warn(
        record.parked
          ? `github pr outbox ${row.kind} ${row.id} parked without spending an attempt: ${record.lastError}`
          : `github pr outbox ${row.kind} ${row.id} failed on attempt ${record.attempts}${record.deadLettered ? ' and was dead-lettered' : ''}: ${record.lastError}`,
      )

      return false
    }

    return true
  }

  private legacyEffects(): GithubLegacyEffects {
    if (this.deps.legacy === undefined) {
      throw new Error('a v1 pr outbox effect was claimed without the legacy effects port')
    }
    return this.deps.legacy
  }

  private async perform(row: Row<'GithubPrOutbox'>): Promise<void> {
    if (row.kind === 'thread-signal') {
      const payload = row.payload as { threadId: string }
      this.legacyEffects().threadChanged({ threadId: payload.threadId })

      return
    }
    if (row.kind === 'wake') {
      const payload = row.payload as WakePayload
      await this.legacyEffects().notifyEvent(payload.notice, payload.event)

      return
    }
    if (row.kind === 'v2-notice') {
      const event = await db.orm.public.GithubPrEvent.where({
        id: (row.payload as { eventId: string }).eventId,
      }).first()
      if (event === null) return
      await db.transaction((tx) => noticeV2Sessions({ tx, event }))

      return
    }
    if (row.kind === 'reconcile-checks') {
      await this.deps.reconcile(row.payload as { repoFullName: string; headSha: string })
      return
    }
    if (row.kind === 'mergeability-refresh') {
      await this.deps.mergeability(row.payload as { repoFullName: string; prNumber: number })
      return
    }
    if (row.kind === 'fanout') {
      const payload = row.payload as unknown as FanoutPayload
      if ('state' in payload) {
        this.deps.fanout.push({ userIds: payload.userIds, state: payload.state })
        return
      }
      this.deps.fanout.pushEvent({
        userIds: payload.userIds,
        event: payload.event,
        ackId: payload.ackId,
      })
    }
  }
}

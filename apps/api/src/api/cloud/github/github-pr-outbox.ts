import { randomUUID } from 'node:crypto'
import { Logger } from '@nestjs/common'
import { db, type Row, type Tx } from '@dltech/atlas-db'

import type { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import type { GithubPrFanoutService } from './github-pr-fanout.service'
import {
  claimPrOutboxRows,
  completePrOutboxRow,
  failPrOutboxRow,
  prOutboxOwnerOf,
} from './github-pr-outbox-lease'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'
import type { WakeEventNotice, WakePrEvent } from './github-sandbox-wake-intent'
import { noticeV2Sessions } from './github-v2-notice'
import type { GithubPrEventDto, GithubPrStateDto } from './github-realtime.types'

export const PR_OUTBOX_BATCH = 32
export const PR_OUTBOX_RETENTION_MS = 24 * 60 * 60 * 1_000

export type PrOutboxLogger = { warn(message: string): void }

type OutboxPayload = Row<'GithubPrOutbox'>['payload']
type WakePayload = { notice: WakeEventNotice; event: WakePrEvent }
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

export type PrReconcileRun = (args: { repoFullName: string; headSha: string }) => Promise<void>

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
  private readonly owner = prOutboxOwnerOf()
  private readonly logger: PrOutboxLogger
  private readonly now: () => Date

  constructor(
    private readonly deps: {
      fanout: Pick<GithubPrFanoutService, 'push' | 'pushEvent'>
      signals: Pick<ThreadSignalsService, 'threadChanged'>
      wake: Pick<GithubSandboxWakeService, 'notifyEvent'>
      reconcile: PrReconcileRun
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
      await claimPrOutboxRows({ now: this.now(), owner: this.owner, limit: ids.length, ids }),
    )
  }

  async drain(): Promise<number> {
    const claimed = await claimPrOutboxRows({
      now: this.now(),
      owner: this.owner,
      limit: PR_OUTBOX_BATCH,
    })
    await this.runClaim(claimed)

    return claimed.rows.length
  }

  private async runClaim(claimed: {
    rows: readonly Row<'GithubPrOutbox'>[]
    deadLettered: readonly Row<'GithubPrOutbox'>[]
  }): Promise<void> {
    for (const row of claimed.deadLettered) {
      this.logger.warn(
        `github pr outbox ${row.kind} ${row.id} dead-lettered after ${row.attempts} attempts: ${row.lastError ?? 'no error recorded'}`,
      )
    }
    for (const row of claimed.rows) await this.run(row)
  }

  prune(args: { now: Date }): Promise<number> {
    return db.orm.public.GithubPrOutbox.where((row) =>
      row.dispatchedAt.lt(new Date(args.now.getTime() - PR_OUTBOX_RETENTION_MS)),
    ).deleteAndCount()
  }

  private async run(row: Row<'GithubPrOutbox'>): Promise<void> {
    try {
      await this.perform(row)
    } catch (failure) {
      const record = await failPrOutboxRow({ row, owner: this.owner, failure, now: this.now() })
      this.logger.warn(
        `github pr outbox ${row.kind} ${row.id} failed on attempt ${record.attempts}${record.deadLettered ? ' and was dead-lettered' : ''}: ${record.lastError}`,
      )
      return
    }
    if (!(await completePrOutboxRow({ id: row.id, owner: this.owner, now: this.now() }))) {
      this.logger.warn(
        `github pr outbox ${row.kind} ${row.id} lost its lease before its effect finished; it will run again`,
      )
    }
  }

  private async perform(row: Row<'GithubPrOutbox'>): Promise<void> {
    if (row.kind === 'thread-signal') {
      const payload = row.payload as { threadId: string }
      this.deps.signals.threadChanged({ threadId: payload.threadId })

      return
    }
    if (row.kind === 'wake') {
      const payload = row.payload as WakePayload
      await this.deps.wake.notifyEvent(payload.notice, payload.event)

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

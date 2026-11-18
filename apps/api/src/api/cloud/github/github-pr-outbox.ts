import { randomUUID } from 'node:crypto'
import { db, type Row, type Tx } from '@dltech/atlas-db'

import type { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import type { GithubPrFanoutService } from './github-pr-fanout.service'
import type { GithubSandboxWakeService } from './github-sandbox-wake.service'
import type { WakeEventNotice, WakePrEvent } from './github-sandbox-wake-intent'
import { noticeV2Sessions } from './github-v2-notice'
import type { GithubPrEventDto, GithubPrStateDto } from './github-realtime.types'

export const PR_OUTBOX_BATCH = 32
export const PR_OUTBOX_RETENTION_MS = 24 * 60 * 60 * 1_000

type OutboxPayload = Row<'GithubPrOutbox'>['payload']
type WakePayload = { notice: WakeEventNotice; event: WakePrEvent }
type FanoutPayload =
  | { userIds: readonly string[]; state: GithubPrStateDto }
  | { userIds: readonly string[]; event: GithubPrEventDto; ackId: string }

export type PrOutboxEffect =
  | { kind: 'fanout'; payload: FanoutPayload; dedupeKey: string }
  | { kind: 'thread-signal'; payload: { threadId: string }; dedupeKey: string }
  | { kind: 'wake'; payload: WakePayload; dedupeKey: string }
  | { kind: 'v2-notice'; payload: { eventId: string }; dedupeKey: string }

/**
 * The pushes an apply owes the outside world, gathered while its transaction is still open so
 * nothing leaves the process before the rows are committed.
 */
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

/**
 * Runs committed outbox rows. A row is stamped `dispatchedAt` only after its effect returned, so a
 * crash mid-dispatch leaves it pending for the reconcile drain, and a failure is recorded without
 * losing the row. The dedupe key keeps a retried row from waking or notifying twice.
 */
export class GithubPrOutboxDispatcher {
  private readonly logger: { warn(message: string): void }

  constructor(
    private readonly deps: {
      fanout: Pick<GithubPrFanoutService, 'push' | 'pushEvent'>
      signals: Pick<ThreadSignalsService, 'threadChanged'>
      wake: Pick<GithubSandboxWakeService, 'notifyEvent'>
      logger?: { warn(message: string): void }
    },
  ) {
    this.logger = deps.logger ?? { warn: () => undefined }
  }

  async dispatch(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return
    const rows = await db.orm.public.GithubPrOutbox.where((row) => row.id.in([...ids])).all()
    for (const row of rows) {
      if (row.dispatchedAt !== null) continue
      await this.run(row)
    }
  }

  async drain(): Promise<number> {
    const claimed = await db.transaction(async (tx) => {
      const due = await tx.orm.public.GithubPrOutbox.where({ dispatchedAt: null })
        .orderBy((row) => row.createdAt.asc())
        .limit(PR_OUTBOX_BATCH)
        .forUpdate({ skipLocked: true })
        .all()
      if (due.length === 0) return []
      await tx.orm.public.GithubPrOutbox.where((row) =>
        row.id.in(due.map((held) => held.id)),
      ).updateAndCount({ dispatchedAt: new Date() })

      return due
    })
    for (const row of claimed) await this.run(row)

    return claimed.length
  }

  prune(args: { now: Date }): Promise<number> {
    return db.orm.public.GithubPrOutbox.where((row) =>
      row.dispatchedAt.lt(new Date(args.now.getTime() - PR_OUTBOX_RETENTION_MS)),
    ).deleteAndCount()
  }

  private async run(row: Row<'GithubPrOutbox'>): Promise<boolean> {
    try {
      await this.perform(row)
    } catch (failure) {
      await this.release({ row, failure })
      return false
    }
    await db.orm.public.GithubPrOutbox.where({ id: row.id }).updateAndCount({
      dispatchedAt: new Date(),
      lastError: null,
    })

    return true
  }

  private async release(args: { row: Row<'GithubPrOutbox'>; failure: unknown }): Promise<void> {
    const lastError = String(args.failure).slice(0, 1000)
    await db.orm.public.GithubPrOutbox.where({ id: args.row.id }).updateAndCount({
      dispatchedAt: null,
      attempts: args.row.attempts + 1,
      lastError,
    })
    this.logger.warn(`github pr outbox ${args.row.kind} ${args.row.id} failed: ${lastError}`)
  }

  private async perform(row: Row<'GithubPrOutbox'>): Promise<void> {
    if (row.kind === 'thread-signal') {
      const payload = row.payload as { threadId: string }
      this.deps.signals.threadChanged({ threadId: payload.threadId })

      return
    }
    if (row.kind === 'wake') {
      const payload = row.payload as WakePayload
      this.deps.wake.notifyEvent(payload.notice, payload.event)

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

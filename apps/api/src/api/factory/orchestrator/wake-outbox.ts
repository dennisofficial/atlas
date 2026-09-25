import { db } from '../../../db'
import { nextWakeOutboxId, nowIso } from '../ids'

export enum EWakeOutboxStatus {
  Enqueued = 'enqueued',
  Started = 'started',
  Delivered = 'delivered',
}

export type WakeOutboxRow = {
  id: string
  workItemId: string
  externalId: string
  repo: string | null
  status: string
  createdAt: string
}

export async function enqueueWake(args: {
  workItemId: string
  externalId: string
  repo?: string | undefined
}): Promise<string> {
  const now = nowIso()
  const row = await db.factoryWakeOutbox.create({
    data: {
      id: nextWakeOutboxId(),
      workItemId: args.workItemId,
      externalId: args.externalId,
      repo: args.repo ?? null,
      status: EWakeOutboxStatus.Enqueued,
      createdAt: now,
      updatedAt: now,
      deliveredAt: null,
    },
  })
  return row.id
}

/** FIFO: the wake that has waited longest drives first, so a burst cannot starve the oldest. */
export async function claimNextWake(): Promise<WakeOutboxRow | null> {
  const claimed = await db.$transaction(async (tx) => {
    const row = await tx.factoryWakeOutbox.findFirst({
      where: { status: EWakeOutboxStatus.Enqueued },
      orderBy: { createdAt: 'asc' },
    })
    if (row === null) return null
    await tx.factoryWakeOutbox.update({
      where: { id: row.id },
      data: { status: EWakeOutboxStatus.Started, updatedAt: nowIso() },
    })
    return row
  })
  return claimed
}

export async function markWakeDelivered(args: { id: string }): Promise<void> {
  await db.factoryWakeOutbox.update({
    where: { id: args.id },
    data: { status: EWakeOutboxStatus.Delivered, updatedAt: nowIso(), deliveredAt: nowIso() },
  })
}

/**
 * A wake whose drive ended mid-flight stays enqueued: the drive is idempotent off the delivered
 * watermark and the commit marker, so re-driving one that actually landed is a no-op — which is
 * exactly what a crashed driver's row needs.
 */
export async function resetWake(args: { id: string }): Promise<void> {
  await db.factoryWakeOutbox.update({
    where: { id: args.id },
    data: { status: EWakeOutboxStatus.Enqueued, updatedAt: nowIso() },
  })
}

/** An in-flight wake is memory state; a killed process leaves its rows `started` forever. */
export async function recoverAbandonedWakes(): Promise<number> {
  const result = await db.factoryWakeOutbox.updateMany({
    where: { status: EWakeOutboxStatus.Started },
    data: { status: EWakeOutboxStatus.Enqueued, updatedAt: nowIso() },
  })
  return result.count
}

/** A superseded wake whose work item was re-enqueued is dead weight; nothing ever drives it. */
export async function pruneDeliveredWakes(): Promise<void> {
  await db.factoryWakeOutbox.deleteMany({ where: { status: EWakeOutboxStatus.Delivered } })
}

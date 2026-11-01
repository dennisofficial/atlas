import type { AvailabilityKey, AvailabilityState } from '@dltech/atlas-core'
import { ECredentialAvailability } from '@dltech/atlas-core'
import type { Row, Tx } from '@dltech/atlas-db'

export type BarrierScope = { userId: string; key: AvailabilityKey }

export type DbInstant = { nowMs: number; nowIso: string }

const scopeWhere = (scope: BarrierScope) => ({
  userId: scope.userId,
  accountId: scope.key.accountId,
  providerId: scope.key.providerId,
  modelId: scope.key.modelId,
})

export enum EBarrierLock {
  Shared = 'shared',
  Exclusive = 'exclusive',
}

export async function lockBarrier(args: {
  tx: Tx
  scope: BarrierScope
  mode: EBarrierLock
}): Promise<void> {
  const { userId, key } = args.scope
  const lockKey = `credential-availability:${userId}:${JSON.stringify([key.accountId, key.providerId, key.modelId])}`
  const statement =
    args.mode === EBarrierLock.Shared
      ? args.tx.raw.sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${lockKey}, 0))`
      : args.tx.raw.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`
  await args.tx.execute(statement.affectedCount().build())
}

export async function readInstant(tx: Tx): Promise<DbInstant> {
  const statement = tx.raw
    .sql`SELECT (extract(epoch FROM date_trunc('milliseconds', clock_timestamp())) * 1000)::float8 AS "nowMs"`
    .returnsRow({ nowMs: 'pg/float8@1' })
    .build()
  const [row] = await tx.query(statement)
  if (row === undefined) throw new Error('database returned no clock reading')
  const nowMs = Math.round(row.nowMs)
  return { nowMs, nowIso: new Date(nowMs).toISOString() }
}

export function readRow(args: {
  tx: Tx
  scope: BarrierScope
}): Promise<Row<'CredentialAvailability'> | null> {
  return args.tx.orm.public.CredentialAvailability.where(scopeWhere(args.scope)).first()
}

const isCleared = (state: AvailabilityState): boolean =>
  state.snapshot.availability === ECredentialAvailability.Available && state.probe === undefined

export async function dropLapsedRow(args: {
  tx: Tx
  row: Row<'CredentialAvailability'>
}): Promise<void> {
  await args.tx.orm.public.CredentialAvailability.where({
    id: args.row.id,
    updatedAt: args.row.updatedAt,
  }).deleteAndCount()
}

export async function persistState(args: {
  tx: Tx
  scope: BarrierScope
  state: AvailabilityState | undefined
}): Promise<void> {
  const { tx, scope, state } = args
  const collection = tx.orm.public.CredentialAvailability
  if (state === undefined || isCleared(state)) {
    await collection.where(scopeWhere(scope)).deleteAndCount()
    return
  }
  const { snapshot } = state
  const fields = {
    availability: snapshot.availability,
    fence: snapshot.revision.fence,
    revision: snapshot.revision.value,
    since: new Date(snapshot.since),
    until: snapshot.until === undefined ? null : new Date(snapshot.until),
    reason: snapshot.reason ?? null,
  }
  const released = state.probe === undefined ? { probeId: null, probeExpiresAt: null } : {}
  await collection.upsert({
    conflictOn: scopeWhere(scope),
    create: { ...scopeWhere(scope), ...fields, ...released },
    update: { ...fields, ...released },
  })
}

export async function claimProbe(args: {
  tx: Tx
  userId: string
  rowId: string
  probeId: string
  instant: DbInstant
  leaseMs: number
}): Promise<boolean> {
  const { nowIso } = args.instant
  const expiresIso = new Date(args.instant.nowMs + args.leaseMs).toISOString()
  const statement = args.tx.raw.sql`UPDATE "CredentialAvailability"
    SET "probeId" = ${args.probeId},
        "probeExpiresAt" = ${expiresIso}::timestamptz,
        "updatedAt" = ${nowIso}::timestamptz
    WHERE "id" = ${args.rowId}
      AND "userId" = ${args.userId}
      AND ("probeId" IS NULL OR "probeExpiresAt" <= ${nowIso}::timestamptz)`
    .affectedCount()
    .build()
  const { affectedRows } = await args.tx.execute(statement)
  return affectedRows === 1
}

import type { Tx } from '@dltech/atlas-db'

import type {
  ControlTerminalRow,
  CreateTerminalParams,
  EndTerminalParams,
  TerminalEndedReason,
  TerminalState,
} from '../terminal-rows'

type RawTerminalRow = {
  sessionId: string
  terminalId: string
  ordinal: number
  name: string
  state: string
  exitCode: number | null
  signal: string | null
  endedReason: string | null
  createdAt: Date
  endedAt: Date | null
}

const columns = {
  sessionId: 'pg/text@1',
  terminalId: 'pg/text@1',
  ordinal: 'pg/int4@1',
  name: 'pg/text@1',
  state: 'pg/text@1',
  exitCode: { codecId: 'pg/int4@1', nullable: true },
  signal: { codecId: 'pg/text@1', nullable: true },
  endedReason: { codecId: 'pg/text@1', nullable: true },
  createdAt: 'pg/timestamptz-date@1',
  endedAt: { codecId: 'pg/timestamptz-date@1', nullable: true },
} as const

const endedReasonOf = (reason: string | null): TerminalEndedReason | null =>
  reason === null ? null : (reason as TerminalEndedReason)

const toRow = (row: RawTerminalRow): ControlTerminalRow => ({
  sessionId: row.sessionId,
  terminalId: row.terminalId,
  ordinal: row.ordinal,
  name: row.name,
  state: row.state as TerminalState,
  exitCode: row.exitCode,
  signal: row.signal,
  endedReason: endedReasonOf(row.endedReason),
  createdAt: row.createdAt.toISOString(),
  endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
})

export const listTerminalsIn = async (params: {
  tx: Tx
  sessionId: string
}): Promise<ControlTerminalRow[]> => {
  const rows = await params.tx.query(
    params.tx.raw.sql`SELECT "sessionId", "terminalId", "ordinal", "name", "state", "exitCode",
        "signal", "endedReason", "createdAt", "endedAt"
      FROM "public"."Terminal"
      WHERE "sessionId" = ${params.sessionId} ORDER BY "ordinal" ASC`
      .returnsRow(columns)
      .build(),
  )
  return rows.map(toRow)
}

export const readTerminalIn = async (params: {
  tx: Tx
  sessionId: string
  terminalId: string
}): Promise<ControlTerminalRow | undefined> => {
  const rows = await params.tx.query(
    params.tx.raw.sql`SELECT "sessionId", "terminalId", "ordinal", "name", "state", "exitCode",
        "signal", "endedReason", "createdAt", "endedAt"
      FROM "public"."Terminal"
      WHERE "sessionId" = ${params.sessionId} AND "terminalId" = ${params.terminalId}`
      .returnsRow(columns)
      .build(),
  )
  const row = rows[0]
  return row === undefined ? undefined : toRow(row)
}

export const createTerminalIn = async (
  params: { tx: Tx } & CreateTerminalParams,
): Promise<ControlTerminalRow | undefined> => {
  const rows = await params.tx.query(
    params.tx.raw.sql`INSERT INTO "public"."Terminal"
        ("sessionId", "terminalId", "ordinal", "name", "state", "createdAt")
      SELECT ${params.sessionId}, ${params.terminalId}, n."next", 'Terminal ' || n."next",
          'opening', clock_timestamp()
      FROM (
        SELECT COALESCE(MAX("ordinal"), 0) + 1 AS "next",
            COUNT(*) FILTER (WHERE "state" <> 'ended') AS "live"
        FROM "public"."Terminal" WHERE "sessionId" = ${params.sessionId}
      ) n
      WHERE n."live" < ${params.limit}
      RETURNING "sessionId", "terminalId", "ordinal", "name", "state", "exitCode", "signal",
        "endedReason", "createdAt", "endedAt"`
      .returnsRow(columns)
      .build(),
  )
  const row = rows[0]
  return row === undefined ? undefined : toRow(row)
}

export const renameTerminalIn = async (params: {
  tx: Tx
  sessionId: string
  terminalId: string
  name: string
}): Promise<ControlTerminalRow | undefined> => {
  const changed = await params.tx.orm.public.Terminal.where({
    sessionId: params.sessionId,
    terminalId: params.terminalId,
  }).updateAndCount({ name: params.name })
  return changed === 0 ? undefined : readTerminalIn(params)
}

export const markTerminalOpenIn = async (params: {
  tx: Tx
  sessionId: string
  terminalId: string
}): Promise<void> => {
  await params.tx.orm.public.Terminal.where({
    sessionId: params.sessionId,
    terminalId: params.terminalId,
    state: 'opening',
  }).updateAndCount({ state: 'open' })
}

export const endTerminalIn = async (
  params: { tx: Tx } & EndTerminalParams,
): Promise<ControlTerminalRow | undefined> => {
  const changed = await params.tx.orm.public.Terminal.where({
    sessionId: params.sessionId,
    terminalId: params.terminalId,
  }).updateAndCount({
    state: 'ended',
    endedReason: params.reason,
    exitCode: params.exitCode ?? null,
    signal: params.signal ?? null,
    endedAt: new Date(),
  })
  return changed === 0 ? undefined : readTerminalIn(params)
}

export const endSessionTerminalsIn = async (params: {
  tx: Tx
  sessionId: string
  reason: TerminalEndedReason
}): Promise<number> =>
  params.tx.orm.public.Terminal.where({
    sessionId: params.sessionId,
    state: 'open',
  }).updateAndCount({ state: 'ended', endedReason: params.reason, endedAt: new Date() })

export const deleteTerminalIn = async (params: {
  tx: Tx
  sessionId: string
  terminalId: string
}): Promise<void> => {
  await params.tx.orm.public.Terminal.where({
    sessionId: params.sessionId,
    terminalId: params.terminalId,
  }).deleteAndCount()
}

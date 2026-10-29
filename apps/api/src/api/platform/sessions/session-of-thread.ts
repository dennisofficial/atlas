import { NotFoundException } from '@nestjs/common'
import type { Row } from '@dltech/atlas-db'
import type { SessionReader } from './fork-chain'

export async function sessionOfThread(args: {
  reader: SessionReader
  threadId: string
}): Promise<Row<'Session'>> {
  const thread = await args.reader.orm.public.Thread.where({ id: args.threadId })
    .select('sessionId')
    .first()
  if (thread === null) throw new NotFoundException('thread not found')
  return args.reader.orm.public.Session.where({ id: thread.sessionId }).all().firstOrThrow()
}

const MAX_MANAGER_DEPTH = 8

export async function podSessionOf(args: {
  reader: SessionReader
  threadId: string
}): Promise<string> {
  const own = await sessionOfThread(args)
  let cursor: Row<'Session'> = own
  for (let hop = 0; hop < MAX_MANAGER_DEPTH; hop += 1) {
    const sandbox = await args.reader.orm.public.CloudSandbox.where({ sessionId: cursor.id })
      .select('id')
      .first()
    if (sandbox !== null) return cursor.id
    if (cursor.managedBySessionId === null) break
    const manager = await args.reader.orm.public.Session.where({ id: cursor.managedBySessionId })
      .all()
      .first()
    if (manager === null) break
    cursor = manager
  }
  return own.id
}

export async function podSessionsOf(args: {
  reader: SessionReader
  sessions: readonly Row<'Session'>[]
}): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()
  let pending = args.sessions.map((session) => ({ origin: session.id, cursor: session }))
  for (let hop = 0; hop < MAX_MANAGER_DEPTH && pending.length > 0; hop += 1) {
    const ids = [...new Set(pending.map((entry) => entry.cursor.id))]
    const owners = new Set(
      (
        await args.reader.orm.public.CloudSandbox.where((sandbox) => sandbox.sessionId.in(ids))
          .select('sessionId')
          .all()
      ).map((row) => row.sessionId),
    )
    const unresolved = pending.filter((entry) => {
      if (!owners.has(entry.cursor.id)) return true
      resolved.set(entry.origin, entry.cursor.id)
      return false
    })
    const managerIds = [
      ...new Set(unresolved.flatMap((entry) => entry.cursor.managedBySessionId ?? [])),
    ]
    const managers =
      managerIds.length === 0
        ? []
        : await args.reader.orm.public.Session.where((session) => session.id.in(managerIds)).all()
    const byId = new Map(managers.map((session) => [session.id, session]))
    pending = unresolved.flatMap((entry) => {
      const manager =
        entry.cursor.managedBySessionId === null
          ? undefined
          : byId.get(entry.cursor.managedBySessionId)
      return manager === undefined ? [] : [{ origin: entry.origin, cursor: manager }]
    })
  }
  for (const session of args.sessions)
    if (!resolved.has(session.id)) resolved.set(session.id, session.id)
  return resolved
}

import type { Row, Tx } from '@dltech/atlas-db'

const MAX_MANAGER_DEPTH = 8

const sessionIn = async (args: { tx: Tx; sessionId: string }): Promise<Row<'Session'>> =>
  args.tx.orm.public.Session.where({ id: args.sessionId }).all().firstOrThrow()

export const podSessionIdOfThreadIn = async (args: {
  tx: Tx
  threadId: string
}): Promise<string> => {
  const own = await sessionIn({
    tx: args.tx,
    sessionId: await threadSessionIdIn(args),
  })
  let cursor = own
  for (let hop = 0; hop < MAX_MANAGER_DEPTH; hop += 1) {
    const sandbox = await args.tx.orm.public.CloudSandbox.where({ sessionId: cursor.id })
      .select('id')
      .first()
    if (sandbox !== null) return cursor.id
    if (cursor.managedBySessionId === null) break
    const manager = await args.tx.orm.public.Session.where({ id: cursor.managedBySessionId })
      .all()
      .first()
    if (manager === null) break
    cursor = manager
  }
  return own.id
}

const threadSessionIdIn = async (args: { tx: Tx; threadId: string }): Promise<string> => {
  const thread = await args.tx.orm.public.Thread.where({ id: args.threadId })
    .select('sessionId')
    .first()
  if (thread === null) throw new Error(`unknown thread ${args.threadId}`)
  return thread.sessionId
}

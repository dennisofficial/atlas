import { createDb, createPool, type Db } from '@dltech/atlas-db'

import { databaseUrlWithTls } from './database-url'
import { readAgentHostEnv } from './env'

const QUERY_TIMEOUT_MS = 10_000

const OWNER_CACHE_LIMIT = 500

export type SessionOwner = { userId: string; projectId: string | null }

export type SessionData = {
  db(): Db
  owner(sessionId: string): Promise<SessionOwner | null>
}

const ownerOf = async (args: { db: Db; sessionId: string }): Promise<SessionOwner | null> => {
  const session = await args.db.orm.v2.V2Session.first({ id: args.sessionId })
  if (session === null || session === undefined) return null
  return { userId: session.userId, projectId: session.projectId }
}

export const sessionDataOf = (args: { db?: Db | undefined } = {}): SessionData => {
  let kept: Db | undefined = args.db
  const owners = new Map<string, Promise<SessionOwner | null>>()

  const db = (): Db => {
    if (kept !== undefined) return kept
    const env = readAgentHostEnv()
    kept = createDb(
      createPool(databaseUrlWithTls(env.databaseUrl), { queryTimeoutMs: QUERY_TIMEOUT_MS }),
    )
    return kept
  }

  const owner = async (sessionId: string): Promise<SessionOwner | null> => {
    const cached = owners.get(sessionId)
    if (cached !== undefined) return await cached
    const read = ownerOf({ db: db(), sessionId })
    owners.set(sessionId, read)
    if (owners.size > OWNER_CACHE_LIMIT) {
      const oldest = owners.keys().next()
      if (!oldest.done && oldest.value !== sessionId) owners.delete(oldest.value)
    }
    try {
      return await read
    } catch (failure) {
      owners.delete(sessionId)
      throw failure
    }
  }

  return { db, owner }
}

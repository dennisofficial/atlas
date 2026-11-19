import { createDb, createPool, type Db } from '@dltech/atlas-db'

import { databaseUrlWithTls } from './database-url'
import { readAgentHostEnv } from './env'

const QUERY_TIMEOUT_MS = 10_000

const TREE = 'instructions'

const PATH = '.atlas/ATLAS.md'

export type InstructionsPort = {
  personal(sessionId: string): Promise<string | null>
}

const personalOf = async (args: { db: Db; sessionId: string }): Promise<string | null> => {
  const session = await args.db.orm.v2.V2Session.first({ id: args.sessionId })
  if (session === null || session === undefined) return null
  const file = await args.db.orm.public.UserFile.first({
    userId: session.userId,
    tree: TREE,
    path: PATH,
  })
  if (file === null || file === undefined) return null
  if (file.tombstonedAt !== null && file.tombstonedAt !== undefined) return null
  if (file.content === null || file.content === undefined) return null
  const text = Buffer.from(file.content).toString('utf8')
  return text.trim() === '' ? null : text
}

export const instructionsPort = (args: { db?: Db | undefined } = {}): InstructionsPort => {
  let kept: Db | undefined = args.db

  const database = (): Db => {
    if (kept !== undefined) return kept
    const env = readAgentHostEnv()
    kept = createDb(
      createPool(databaseUrlWithTls(env.databaseUrl), { queryTimeoutMs: QUERY_TIMEOUT_MS }),
    )
    return kept
  }

  return { personal: async (sessionId) => await personalOf({ db: database(), sessionId }) }
}

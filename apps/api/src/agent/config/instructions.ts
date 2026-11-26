import { createDb, createPool, type Db } from '@dltech/atlas-db'

import { databaseUrlWithTls } from './database-url'
import { readAgentHostEnv } from './env'

const QUERY_TIMEOUT_MS = 10_000

const TREE = 'instructions'

const PATH = '.atlas/ATLAS.md'

export type InstructionsPort = {
  personal(sessionId: string): Promise<string | null>
  group(sessionId: string): Promise<string | null>
}

const liveTextOf = (content: string | null | undefined): string | null => {
  if (content === null || content === undefined) return null
  return content.trim() === '' ? null : content
}

const personalOf = async (args: { db: Db; sessionId: string }): Promise<string | null> => {
  const session = await args.db.orm.public.Session.first({ id: args.sessionId })
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

const groupOf = async (args: { db: Db; sessionId: string }): Promise<string | null> => {
  const session = await args.db.orm.public.Session.first({ id: args.sessionId })
  if (session === null || session === undefined) return null
  if (session.projectId === null) return null
  const project = await args.db.orm.public.Project.where({ id: session.projectId })
    .select('groupId')
    .first()
  if (project?.groupId === null || project?.groupId === undefined) return null
  const instruction = await args.db.orm.public.GroupInstruction.first({
    groupId: project.groupId,
  })
  return liveTextOf(instruction?.content)
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

  return {
    personal: async (sessionId) => await personalOf({ db: database(), sessionId }),
    group: async (sessionId) => await groupOf({ db: database(), sessionId }),
  }
}

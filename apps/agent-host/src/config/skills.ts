import { createDb, createPool, type Db } from '@dltech/atlas-db'
import {
  BUILT_IN_SKILL_NAMES,
  type CloudSkillEntry,
  type CloudSkillSource,
  type CloudSkillWriteResult,
  type CloudSkillWriter,
} from '@dltech/atlas-plugin-skills/pod'

import { databaseUrlWithTls } from './database-url'
import { readAgentHostEnv } from './env'
import { skillFrontmattersOf, skillTextOf, type SkillOwner } from './skill-body'
import { skillIndexOf } from './skill-index'
import { skillWriterOf } from './skill-writes'

const QUERY_TIMEOUT_MS = 10_000

const NO_OWNER = 'this session has no owner to write skills for'

const refusal = (reason: string): CloudSkillWriteResult => ({ ok: false, reason, current: null })

export type SkillCloudPort = {
  source(sessionId: string): CloudSkillSource
  writer(sessionId: string): CloudSkillWriter
}

const ownerOf = async (args: { db: Db; sessionId: string }): Promise<SkillOwner | null> => {
  const session = await args.db.orm.v2.V2Session.first({ id: args.sessionId })
  if (session === null || session === undefined) return null
  return { userId: session.userId, projectId: session.projectId }
}

const sourceOf = (args: {
  db: () => Db
  owner: () => Promise<SkillOwner | null>
}): CloudSkillSource => {
  let entries: readonly CloudSkillEntry[] = []
  return {
    entries: () => entries,
    frontmatter: async () => {
      const owner = await args.owner()
      if (owner === null) {
        entries = []
        return []
      }
      const db = args.db()
      const [texts, index] = await Promise.all([
        skillFrontmattersOf({ db, owner }),
        skillIndexOf({ db, userId: owner.userId, projectId: owner.projectId }),
      ])
      entries = index
      return texts
    },
    body: async (entry) => {
      const owner = await args.owner()
      if (owner === null) return null
      return await skillTextOf({
        db: args.db(),
        owner,
        scope: entry.scope,
        name: entry.name,
      })
    },
    file: async (entry, path) => {
      const owner = await args.owner()
      if (owner === null) return null
      return await skillTextOf({
        db: args.db(),
        owner,
        scope: entry.scope,
        name: entry.name,
        path,
      })
    },
  }
}

const writerOf = (args: {
  db: () => Db
  owner: () => Promise<SkillOwner | null>
}): CloudSkillWriter => ({
  write: async (request) => {
    const owner = await args.owner()
    if (owner === null) return refusal(NO_OWNER)
    return await skillWriterOf({
      db: args.db(),
      owner,
      builtInNames: BUILT_IN_SKILL_NAMES,
    }).write(request)
  },
  remove: async (request) => {
    const owner = await args.owner()
    if (owner === null) return refusal(NO_OWNER)
    return await skillWriterOf({
      db: args.db(),
      owner,
      builtInNames: BUILT_IN_SKILL_NAMES,
    }).remove(request)
  },
})

export const skillCloudPort = (args: { db?: Db | undefined } = {}): SkillCloudPort => {
  let kept: Db | undefined = args.db
  const owners = new Map<string, Promise<SkillOwner | null>>()

  const database = (): Db => {
    if (kept !== undefined) return kept
    const env = readAgentHostEnv()
    kept = createDb(
      createPool(databaseUrlWithTls(env.databaseUrl), { queryTimeoutMs: QUERY_TIMEOUT_MS }),
    )
    return kept
  }

  const ownerFor = async (sessionId: string): Promise<SkillOwner | null> => {
    const cached = owners.get(sessionId)
    if (cached !== undefined) return await cached
    const read = ownerOf({ db: database(), sessionId })
    owners.set(sessionId, read)
    try {
      return await read
    } catch (failure) {
      owners.delete(sessionId)
      throw failure
    }
  }

  return {
    source: (sessionId) => sourceOf({ db: database, owner: () => ownerFor(sessionId) }),
    writer: (sessionId) => writerOf({ db: database, owner: () => ownerFor(sessionId) }),
  }
}

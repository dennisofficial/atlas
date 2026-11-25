import { ESettingId } from '@dltech/atlas-core'
import type { Db } from '@dltech/atlas-db'
import { readOf } from '@dltech/atlas-models'
import {
  BUILT_IN_SKILL_NAMES,
  type CloudSkillEntry,
  type CloudSkillSource,
  type CloudSkillWriteResult,
  type CloudSkillWriter,
} from '@dltech/atlas-plugin-skills/pod'

import { scopedSettingsOf } from './scoped-settings'
import { sessionDataOf, type SessionOwner } from './session-data'
import { skillFrontmattersOf, skillTextOf } from './skill-body'
import { skillIndexOf } from './skill-index'
import { skillWriterOf } from './skill-writes'

const NO_OWNER = 'this session has no owner to write skills for'

const refusal = (reason: string): CloudSkillWriteResult => ({ ok: false, reason, current: null })

export type SkillCloudPort = {
  source(sessionId: string): CloudSkillSource
  writer(sessionId: string): CloudSkillWriter
  suggests(sessionId: string): Promise<boolean>
}

const sourceOf = (args: {
  db: () => Db
  owner: () => Promise<SessionOwner | null>
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
        skillIndexOf({
          db,
          userId: owner.userId,
          projectId: owner.projectId,
          groupId: owner.groupId,
        }),
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

const suggestsOf = async (args: {
  db: () => Db
  owner: () => Promise<SessionOwner | null>
}): Promise<boolean> => {
  const owner = await args.owner()
  if (owner === null) return false
  const settings = await scopedSettingsOf({ db: args.db(), ...owner })
  return readOf(settings)(ESettingId.SkillSuggest) !== false
}

const writerOf = (args: {
  db: () => Db
  owner: () => Promise<SessionOwner | null>
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
  const data = sessionDataOf(args)
  return {
    source: (sessionId) => sourceOf({ db: data.db, owner: () => data.owner(sessionId) }),
    writer: (sessionId) => writerOf({ db: data.db, owner: () => data.owner(sessionId) }),
    suggests: async (sessionId) =>
      await suggestsOf({ db: data.db, owner: () => data.owner(sessionId) }),
  }
}

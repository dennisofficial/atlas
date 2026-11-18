import type { Db } from '@dltech/atlas-db'
import { threadOwnerOf } from '@dltech/atlas-control/postgres'
import type { PodControlClient } from '@dltech/atlas-host'
import {
  MemoryEditRefusedError,
  MemoryInvalidError,
  MemoryNotFoundError,
  MemoryStaleRevisionError,
  editMemory,
  getMemory,
  listMemories,
  putMemory,
  removeMemory,
} from '@dltech/atlas-memory'
import type { PreviewTunnels } from '@dltech/atlas-previews'
import type { MemoryScope } from '@dltech/atlas-plugin-sdk'

import type { SecretCipher } from '../config/secret-cipher'
import { webSearchConfigOf } from './web-search-config'

const refused = (failure: unknown): never => {
  if (
    failure instanceof MemoryInvalidError ||
    failure instanceof MemoryNotFoundError ||
    failure instanceof MemoryStaleRevisionError ||
    failure instanceof MemoryEditRefusedError
  ) {
    throw new Error(failure.message)
  }
  throw failure
}

const projectFor = (args: {
  scope: MemoryScope
  project: string | null
  name: string
}): string | undefined => {
  if (args.scope === 'global') return undefined
  if (args.project === null) {
    throw new Error('this session has no GitHub repository, so only global memory is available')
  }
  return args.project
}

export const localPodControlOf = (args: {
  db: Db
  previews: PreviewTunnels
  cipher: SecretCipher
}): PodControlClient => {
  const ownerOf = (threadId: string) => threadOwnerOf({ handle: args.db, threadId })

  const addressOf = async (call: {
    threadId: string
    scope: MemoryScope
    name: string
  }): Promise<{
    userId: string
    key: { scope: MemoryScope; project: string | undefined; name: string }
  }> => {
    const owner = await ownerOf(call.threadId)
    return {
      userId: owner.userId,
      key: {
        scope: call.scope,
        project: projectFor({
          scope: call.scope,
          project: owner.project,
          name: call.name,
        }),
        name: call.name,
      },
    }
  }

  return {
    exposePort: async ({ threadId, port }) => {
      const owner = await ownerOf(threadId)
      return await args.previews.expose({ threadId, userId: owner.userId, port })
    },
    webSearch: {
      config: async ({ threadId }) => {
        const owner = await ownerOf(threadId)
        return await webSearchConfigOf({
          rows: {
            userSetting: (lookup) => args.db.orm.public.UserSetting.first(lookup),
            projectSetting: (lookup) => args.db.orm.public.ProjectSetting.first(lookup),
            userSecret: (lookup) => args.db.orm.public.UserSecret.first(lookup),
            projectSecret: (lookup) => args.db.orm.public.ProjectSecret.first(lookup),
          },
          cipher: args.cipher,
          userId: owner.userId,
          projectId: owner.projectId,
        })
      },
    },
    memory: {
      list: async ({ threadId }) => {
        const owner = await ownerOf(threadId)
        try {
          const memories = await listMemories({
            db: args.db,
            userId: owner.userId,
            project: owner.project ?? undefined,
          })
          return { project: owner.project, memories }
        } catch (failure) {
          return refused(failure)
        }
      },
      read: async (call) => {
        const { userId, key } = await addressOf(call)
        try {
          return await getMemory({ db: args.db, userId, ...key })
        } catch (failure) {
          if (failure instanceof MemoryNotFoundError) return null
          return refused(failure)
        }
      },
      write: async (call) => {
        const { userId, key } = await addressOf(call)
        try {
          return await putMemory({
            db: args.db,
            userId,
            ...key,
            description: call.description,
            type: call.type,
            body: call.body,
          })
        } catch (failure) {
          return refused(failure)
        }
      },
      edit: async (call) => {
        const { userId, key } = await addressOf(call)
        try {
          return await editMemory({
            db: args.db,
            userId,
            ...key,
            old: call.old,
            replacement: call.new,
            revision: call.revision,
          })
        } catch (failure) {
          return refused(failure)
        }
      },
      remove: async (call) => {
        const { userId, key } = await addressOf(call)
        try {
          await removeMemory({ db: args.db, userId, ...key })
          return true
        } catch (failure) {
          if (failure instanceof MemoryNotFoundError) return false
          return refused(failure)
        }
      },
    },
  }
}

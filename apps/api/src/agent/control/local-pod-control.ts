import type { Db } from '@dltech/atlas-db'
import { ESubscriptionActor, ESubscriptionEnd } from '@dltech/atlas-core'
import {
  RoutineInvalidError,
  RoutineNotFoundError,
  routineCreateOf,
  routineGetOf,
  routineListOf,
  routineRemoveOf,
  routineRunNowOf,
  routineUpdateOf,
  type ControlPlane,
} from '@dltech/atlas-control'
import { threadOwnerOf, type ThreadOwner } from '@dltech/atlas-control/postgres'
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
import type { PreviewReconciler, PreviewTunnels } from '@dltech/atlas-previews'
import type { MemoryScope } from '@dltech/atlas-plugin-sdk'

import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { gatewayKeyOf } from './gateway-key'
import { imageModelOf } from './image-model-setting'
import { settingsVersionsOf } from './settings-versions'
import { scopedSettingsOf } from '../config/scoped-settings'

const NOT_IN_A_PROJECT = 'this session has no Atlas Cloud project, and routines belong to a project'

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

const routineRefused = (failure: unknown): never => {
  if (failure instanceof RoutineInvalidError || failure instanceof RoutineNotFoundError) {
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

const sessionOfThreadOf = async (args: {
  db: Db
  threadId: string
}): Promise<{ sessionId: string }> => {
  const main = await args.db.orm.public.Session.where({ mainThreadId: args.threadId })
    .select('id')
    .first()
  if (main !== null) return { sessionId: main.id }
  const thread = await args.db.orm.public.Thread.where({ id: args.threadId })
    .select('sessionId')
    .first()
  if (thread === null) throw new Error(`unknown thread ${args.threadId}`)
  return { sessionId: thread.sessionId }
}

const routineScopeOf = (owner: ThreadOwner): { userId: string; projectId: string } => {
  if (owner.projectId === null) throw new Error(NOT_IN_A_PROJECT)
  return { userId: owner.userId, projectId: owner.projectId }
}

export const localPodControlOf = (args: {
  db: Db
  previews: PreviewTunnels
  reconciler: PreviewReconciler
  podOf: (args: { threadId: string }) => Promise<string>
  cipher: SecretCipher
  plane: ControlPlane
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
    settingsVersions: async ({ threadId }) => await settingsVersionsOf({ db: args.db, threadId }),
    exposePort: async ({ threadId, port }) => {
      const owner = await ownerOf(threadId)
      const podSessionId = await args.podOf({ threadId })
      const exposed = await args.previews.expose({
        podSessionId,
        threadId,
        userId: owner.userId,
        port,
      })
      const outcome = await args.reconciler.run({ podSessionId })
      if (outcome.kind === 'failed') throw new Error(outcome.reason)
      return exposed
    },
    routines: {
      list: async ({ threadId }) => {
        const scope = routineScopeOf(await ownerOf(threadId))
        try {
          const listed = await routineListOf({ plane: args.plane, ...scope })
          return listed.routines
        } catch (failure) {
          return routineRefused(failure)
        }
      },
      get: async ({ threadId, routineId }) => {
        const scope = routineScopeOf(await ownerOf(threadId))
        try {
          return await routineGetOf({ plane: args.plane, ...scope, routineId })
        } catch (failure) {
          return routineRefused(failure)
        }
      },
      create: async ({ threadId, ...input }) => {
        const scope = routineScopeOf(await ownerOf(threadId))
        try {
          return await routineCreateOf({
            plane: args.plane,
            userId: scope.userId,
            input: { ...input, projectId: scope.projectId },
          })
        } catch (failure) {
          return routineRefused(failure)
        }
      },
      update: async ({ threadId, ...input }) => {
        const scope = routineScopeOf(await ownerOf(threadId))
        try {
          return await routineUpdateOf({ plane: args.plane, ...scope, input })
        } catch (failure) {
          return routineRefused(failure)
        }
      },
      remove: async ({ threadId, routineId }) => {
        const scope = routineScopeOf(await ownerOf(threadId))
        try {
          return await routineRemoveOf({ plane: args.plane, ...scope, routineId })
        } catch (failure) {
          return routineRefused(failure)
        }
      },
      run: async ({ threadId, routineId }) => {
        const scope = routineScopeOf(await ownerOf(threadId))
        try {
          return await routineRunNowOf({ plane: args.plane, ...scope, routineId })
        } catch (failure) {
          return routineRefused(failure)
        }
      },
    },
    subscriptions: {
      list: async ({ threadId }) => {
        const session = await sessionOfThreadOf({ db: args.db, threadId })
        return await args.plane.listSubscriptions({ sessionId: session.sessionId, threadId })
      },
      subscribe: async ({ threadId, ...input }) => {
        const session = await sessionOfThreadOf({ db: args.db, threadId })
        return await args.plane.subscribe({
          sessionId: session.sessionId,
          threadId,
          ...input,
          by: ESubscriptionActor.Agent,
        })
      },
      unsubscribe: async ({ threadId, subscriptionId }) => {
        const session = await sessionOfThreadOf({ db: args.db, threadId })
        return await args.plane.unsubscribe({
          sessionId: session.sessionId,
          subscriptionId,
          by: ESubscriptionActor.Agent,
          reason: ESubscriptionEnd.Unsubscribed,
        })
      },
      end: async ({ threadId, subscriptionId, reason, by }) => {
        const session = await sessionOfThreadOf({ db: args.db, threadId })
        return await args.plane.unsubscribe({
          sessionId: session.sessionId,
          subscriptionId,
          by,
          reason,
        })
      },
    },
    gateway: {
      apiKey: async ({ threadId }) => {
        const owner = await ownerOf(threadId)
        return await gatewayKeyOf({
          rows: {
            accounts: async (userId) =>
              await args.db.orm.public.AgentAccount.where({ userId }).all(),
            active: async (userId) =>
              await args.db.orm.public.ActiveAccount.where({ userId }).all(),
          },
          cipher: args.cipher,
          userId: owner.userId,
        })
      },
      imageModel: async ({ threadId }) => {
        const owner = await ownerOf(threadId)
        const settings = await scopedSettingsOf({
          db: args.db,
          userId: owner.userId,
          projectId: owner.projectId,
        })
        return imageModelOf(settings)
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

import type { ControlPlane } from '@dltech/atlas-control'
import { refKey, toThreadId, type ThreadId } from '@dltech/atlas-core'
import type { PodSessions, SpawnedSession } from '@dltech/atlas-plugin-sdk'

import { derivedIdOf } from './derived-id'
import type { ParkArchivedPod } from './park-archived'
import type { PodStepRunner } from './plugin-context'
import type { RoleModelChoice } from './ports'

type SpawnInput = Parameters<PodSessions['spawn']>[0]

const spawnedOf = async (args: {
  plane: ControlPlane
  sessionId: string
  model: () => RoleModelChoice
  onFallback?: ((args: { agentId: ThreadId; model: RoleModelChoice }) => Promise<void>) | undefined
  input: SpawnInput
  key: string
  replayed?: boolean | undefined
}): Promise<SpawnedSession> => {
  const model = args.model()
  const sessionId = derivedIdOf(`session:${args.sessionId}:${args.key}`)
  const mainThreadId = derivedIdOf(`thread:${args.sessionId}:${args.key}`)
  const spawned = await args.plane.spawnPeer({
    spawnerSessionId: args.sessionId,
    sessionId,
    mainThreadId,
    modelRef: refKey(model.ref),
    modelEffort: model.effort,
    modelFast: model.fast,
    clientId: args.key,
    replayed: args.replayed,
    ...(args.input.title === undefined ? {} : { title: args.input.title }),
    ...(args.input.brief === undefined ? {} : { brief: args.input.brief }),
    ...(args.input.nested === undefined ? {} : { nested: args.input.nested }),
    ...(args.input.files === undefined ? {} : { files: args.input.files }),
  })
  if ('refused' in spawned) throw new Error(spawned.refused)
  if (model.unavailable !== undefined) {
    await args.onFallback?.({ agentId: toThreadId(mainThreadId), model })
  }
  return { sessionId, mainThreadId }
}

export const podSessionsOf = (args: {
  plane: ControlPlane
  sessionId: string
  step: PodStepRunner
  model: () => RoleModelChoice
  onFallback?: ((args: { agentId: ThreadId; model: RoleModelChoice }) => Promise<void>) | undefined
  parkArchived?: ParkArchivedPod | undefined
}): PodSessions => ({
  spawn: async (input) =>
    await args.step.run({
      op: 'host.sessions.spawn',
      input,
      identity: {
        title: input.title,
        brief: input.brief,
        nested: input.nested,
        files: input.files?.map((file) => file.path),
      },
      run: async (key, replayed) =>
        await spawnedOf({
          plane: args.plane,
          sessionId: args.sessionId,
          model: args.model,
          input,
          key,
          replayed,
          ...(args.onFallback === undefined ? {} : { onFallback: args.onFallback }),
        }),
    }),
  archive: async ({ sessionId }) => {
    const archived = await args.plane.archiveSpawned({ fromSessionId: args.sessionId, sessionId })
    if ('refused' in archived) return { refused: archived.refused }
    if (!archived.already) await args.parkArchived?.({ sessionId })
    return { archived: true, already: archived.already }
  },
  list: async () => {
    const roster = await args.plane.sessionsOf({ sessionId: args.sessionId })
    return roster.sessions.map((row) => ({
      sessionId: row.sessionId,
      title: row.title,
      spawnedBy: row.spawnedBySessionId,
      nested: row.nested,
      archivedAt: row.archivedAt,
      current: row.sessionId === args.sessionId,
      status: row.view?.status ?? null,
    }))
  },
  teammates: async () => {
    const roster = await args.plane.sessionsOf({ sessionId: args.sessionId })
    return roster.sessions
      .filter((row) => row.spawnedBySessionId === args.sessionId && row.nested)
      .map((row) => ({
        sessionId: row.sessionId,
        title: row.title,
        spawnedBy: row.spawnedBySessionId,
        nested: row.nested,
        archivedAt: row.archivedAt,
        current: false,
        status: row.view?.status ?? null,
      }))
  },
})

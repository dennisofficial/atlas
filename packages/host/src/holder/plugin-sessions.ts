import { randomUUID } from 'node:crypto'

import type { ControlPlane } from '@dltech/atlas-control'
import { refKey, toThreadId, type ThreadId } from '@dltech/atlas-core'
import type { PodSessions } from '@dltech/atlas-plugin-sdk'

import type { RoleModelChoice } from './ports'

export const podSessionsOf = (args: {
  plane: ControlPlane
  sessionId: string
  model: () => RoleModelChoice
  onFallback?: ((args: { agentId: ThreadId; model: RoleModelChoice }) => Promise<void>) | undefined
}): PodSessions => ({
  spawn: async ({ title, brief, nested, files }) => {
    const model = args.model()
    const sessionId = randomUUID()
    const mainThreadId = randomUUID()
    const spawned = await args.plane.spawnPeer({
      spawnerSessionId: args.sessionId,
      sessionId,
      mainThreadId,
      modelRef: refKey(model.ref),
      modelEffort: model.effort,
      modelFast: model.fast,
      title,
      brief,
      nested,
      ...(files === undefined ? {} : { files }),
    })
    if ('refused' in spawned) throw new Error(spawned.refused)
    if (model.unavailable !== undefined) {
      await args.onFallback?.({ agentId: toThreadId(mainThreadId), model })
    }
    return { sessionId, mainThreadId }
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

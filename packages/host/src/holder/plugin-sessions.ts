import { randomUUID } from 'node:crypto'

import type { ControlPlane } from '@dltech/atlas-control'
import { refKey, toThreadId, type ThreadId } from '@dltech/atlas-core'
import type { PodSessions } from '@dltech/atlas-plugin-sdk'

import type { RoleModelChoice } from './ports'

export const podSessionsOf = (args: {
  plane: ControlPlane
  sessionId: string
  model: RoleModelChoice
  onFallback?: ((agentId: ThreadId) => Promise<void>) | undefined
}): PodSessions => ({
  spawn: async ({ title, brief, nested }) => {
    const sessionId = randomUUID()
    const mainThreadId = randomUUID()
    await args.plane.spawnPeer({
      spawnerSessionId: args.sessionId,
      sessionId,
      mainThreadId,
      modelRef: refKey(args.model.ref),
      modelEffort: args.model.effort,
      modelFast: args.model.fast,
      title,
      brief,
      nested,
    })
    if (args.model.unavailable !== undefined) await args.onFallback?.(toThreadId(mainThreadId))
    return { sessionId, mainThreadId }
  },
  message: async ({ sessionId, text }) => {
    const sent = await args.plane.messagePeer({
      fromSessionId: args.sessionId,
      toSessionId: sessionId,
      text,
    })
    return 'refused' in sent ? { refused: sent.refused } : { queued: true }
  },
  messageTeammate: async ({ sessionId, text }) => {
    const sent = await args.plane.messageTeammate({
      fromSessionId: args.sessionId,
      toSessionId: sessionId,
      text,
    })
    return 'refused' in sent ? { refused: sent.refused } : { queued: true }
  },
  report: async ({ kind, text }) => {
    const sent = await args.plane.reportToSpawner({
      sessionId: args.sessionId,
      kind,
      text,
    })
    return 'refused' in sent ? { refused: sent.refused } : { queued: true }
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

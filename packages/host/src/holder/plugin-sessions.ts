import { randomUUID } from 'node:crypto'

import type { ControlPlane } from '@dltech/atlas-control'
import type { PodSessions } from '@dltech/atlas-plugin-sdk'

export const podSessionsOf = (args: { plane: ControlPlane; sessionId: string }): PodSessions => ({
  spawn: async ({ title, brief }) => {
    const sessionId = randomUUID()
    const mainThreadId = randomUUID()
    await args.plane.spawnPeer({
      spawnerSessionId: args.sessionId,
      sessionId,
      mainThreadId,
      title,
      brief,
    })
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
      archivedAt: row.archivedAt,
      current: row.sessionId === args.sessionId,
      status: row.view?.status ?? null,
    }))
  },
})

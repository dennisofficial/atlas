import { randomUUID } from 'node:crypto'

import type { ControlPlane } from '@dltech/atlas-control'
import type { PeerSessionSummary, PodSessions } from '@dltech/atlas-plugin-sdk'

const summaryOf = (row: {
  sessionId: string
  title: string | null
  spawnedBySessionId: string | null
  archivedAt: string | null
}): PeerSessionSummary => ({
  sessionId: row.sessionId,
  title: row.title,
  spawnedBy: row.spawnedBySessionId,
  archivedAt: row.archivedAt,
})

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
  list: async () => {
    const roster = await args.plane.peersOf({ sessionId: args.sessionId })
    return {
      spawner: roster.spawner === null ? null : summaryOf(roster.spawner),
      peers: roster.peers.map(summaryOf),
    }
  },
})

export type PeerSessionSummary = {
  sessionId: string
  title: string | null
  spawnedBy: string | null
  archivedAt: string | null
}

export type PeerSpawned = { sessionId: string; mainThreadId: string }

export type PeerMessage = { queued: true } | { refused: string }

export type PeerRoster = {
  spawner: PeerSessionSummary | null
  peers: readonly PeerSessionSummary[]
}

export type PodSessions = {
  spawn(args: { title?: string | undefined; brief?: string | undefined }): Promise<PeerSpawned>
  message(args: { sessionId: string; text: string }): Promise<PeerMessage>
  list(): Promise<PeerRoster>
}

export const EMPTY_SESSIONS: PodSessions = Object.freeze({
  spawn: async () => {
    throw new Error('this session cannot spawn peer sessions')
  },
  message: async () => ({ refused: 'this session cannot message peer sessions' }),
  list: async () => ({ spawner: null, peers: [] }),
})

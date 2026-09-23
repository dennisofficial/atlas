export type ThreadLineageRow = {
  id: string
  spawnerThreadId: string | null
}

export type SessionGrouping = {
  sessions: Map<string, string[]>
  orphanedAgents: string[]
}

export function groupThreadsIntoSessions({
  threads,
}: {
  threads: ThreadLineageRow[]
}): SessionGrouping {
  const byId = new Map(threads.map((thread) => [thread.id, thread]))
  const sessions = new Map<string, string[]>()
  const orphanedAgents: string[] = []

  for (const thread of threads) {
    const rootId = supervisionRootOf({ thread, byId })
    if (rootId.orphaned) orphanedAgents.push(thread.id)
    const members = sessions.get(rootId.id) ?? []
    members.push(thread.id)
    sessions.set(rootId.id, members)
  }

  return { sessions, orphanedAgents }
}

function supervisionRootOf({
  thread,
  byId,
}: {
  thread: ThreadLineageRow
  byId: Map<string, ThreadLineageRow>
}): { id: string; orphaned: boolean } {
  const visited = new Set<string>([thread.id])
  let current = thread

  while (current.spawnerThreadId !== null) {
    const spawner = byId.get(current.spawnerThreadId)
    if (spawner === undefined || visited.has(spawner.id)) {
      return { id: thread.id, orphaned: true }
    }
    visited.add(spawner.id)
    current = spawner
  }

  return { id: current.id, orphaned: false }
}

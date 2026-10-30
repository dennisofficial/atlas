import { REFERENCE_CHAIN_LIMIT, type SessionReader } from './fork-chain'
import { threadsPullRequests } from './places'
import type { LinkedPullRequestDto } from './sessions.types'

type SpawnedThread = {
  id: string
  spawnerThreadId: string
  title: string | null
}

async function spawnedBy(args: {
  reader: SessionReader
  threadIds: readonly string[]
}): Promise<SpawnedThread[]> {
  const threads = await args.reader.orm.public.Thread.where((thread) =>
    thread.spawnerThreadId.in([...args.threadIds]),
  )
    .select('id', 'spawnerThreadId')
    .orderBy((thread) => thread.createdAt.asc())
    .all()
  if (threads.length === 0) return []
  const sessions = await args.reader.orm.public.Session.where((session) =>
    session.mainThreadId.in(threads.map((thread) => thread.id)),
  )
    .select('mainThreadId', 'title')
    .all()
  const titles = new Map(sessions.map((session) => [session.mainThreadId, session.title]))
  return threads.flatMap((thread) =>
    thread.spawnerThreadId === null
      ? []
      : [
          {
            id: thread.id,
            spawnerThreadId: thread.spawnerThreadId,
            title: titles.get(thread.id) ?? null,
          },
        ],
  )
}

export async function spawnedPullRequestsByThread(args: {
  reader: SessionReader
  threadIds: readonly string[]
}): Promise<Map<string, LinkedPullRequestDto[]>> {
  const origins = [...new Set(args.threadIds)]
  const found = new Map<string, LinkedPullRequestDto[]>(origins.map((id) => [id, []]))
  const visited = new Map(origins.map((id) => [id, new Set([id])]))
  let frontiers = new Map(origins.map((id) => [id, [id]]))

  for (let depth = 0; depth < REFERENCE_CHAIN_LIMIT; depth += 1) {
    const active = [...frontiers].filter(([, frontier]) => frontier.length > 0)
    if (active.length === 0) break

    const spawned = await spawnedBy({
      reader: args.reader,
      threadIds: [...new Set(active.flatMap(([, frontier]) => frontier))],
    })
    const pullRequests = await threadsPullRequests({
      reader: args.reader,
      threadIds: spawned.map((thread) => thread.id),
    })

    const next = new Map<string, string[]>()
    for (const [origin, frontier] of active) {
      const seen = visited.get(origin)
      const out = found.get(origin)
      if (seen === undefined || out === undefined) continue
      const members = new Set(frontier)
      const fresh = spawned.filter(
        (thread) => members.has(thread.spawnerThreadId) && !seen.has(thread.id),
      )
      for (const thread of fresh) seen.add(thread.id)
      for (const thread of fresh) {
        for (const pullRequest of pullRequests.get(thread.id) ?? []) {
          out.push({
            ...pullRequest,
            via: { threadId: thread.id, title: thread.title },
          })
        }
      }
      next.set(
        origin,
        fresh.map((thread) => thread.id),
      )
    }
    frontiers = next
  }

  return found
}

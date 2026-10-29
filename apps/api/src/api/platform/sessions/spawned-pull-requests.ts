import { REFERENCE_CHAIN_LIMIT, type SessionReader } from './fork-chain'
import { threadPullRequests } from './places'
import type { LinkedPullRequestDto } from './sessions.types'

type SpawnedThread = { id: string; title: string | null }

async function spawnedBy(args: {
  reader: SessionReader
  threadIds: readonly string[]
}): Promise<SpawnedThread[]> {
  const threads = await args.reader.orm.public.Thread.where((thread) =>
    thread.spawnerThreadId.in([...args.threadIds]),
  )
    .select('id', 'sessionId', 'agentType')
    .orderBy((thread) => thread.createdAt.asc())
    .all()
  const sessions = await args.reader.orm.public.Session.where((session) =>
    session.mainThreadId.in(threads.map((thread) => thread.id)),
  )
    .select('mainThreadId', 'title')
    .all()
  const titles = new Map(sessions.map((session) => [session.mainThreadId, session.title]))
  return threads.map((thread) => ({ id: thread.id, title: titles.get(thread.id) ?? null }))
}

export async function spawnedPullRequests(args: {
  reader: SessionReader
  threadId: string
}): Promise<LinkedPullRequestDto[]> {
  const visited = new Set<string>([args.threadId])
  const found: LinkedPullRequestDto[] = []
  let frontier = [args.threadId]

  for (let depth = 0; depth < REFERENCE_CHAIN_LIMIT && frontier.length > 0; depth += 1) {
    const spawned = (await spawnedBy({ reader: args.reader, threadIds: frontier })).filter(
      (thread) => !visited.has(thread.id),
    )
    for (const thread of spawned) visited.add(thread.id)

    const batches = await Promise.all(
      spawned.map((thread) => threadPullRequests({ reader: args.reader, threadId: thread.id })),
    )
    batches.forEach((pullRequests, index) => {
      const thread = spawned[index]
      if (thread === undefined) return
      for (const pullRequest of pullRequests) {
        found.push({ ...pullRequest, via: { threadId: thread.id, title: thread.title } })
      }
    })
    frontier = spawned.map((thread) => thread.id)
  }

  return found
}

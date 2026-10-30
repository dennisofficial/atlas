import type { LinkedPullRequestDto, ThreadWorktreeDto } from './sessions.types'
import { REFERENCE_CHAIN_LIMIT, type SessionReader } from './fork-chain'

const WORKTREE_EVENT_TYPES = ['worktree-entered', 'worktree-exited', 'directory-changed']
const PULL_REQUEST_EVENT_TYPE = 'pull-request-linked'

const enteredFrom = (body: string): ThreadWorktreeDto | null => {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== 'object' || parsed === null) return null

    const { path, branch } = parsed as Record<string, unknown>
    if (typeof path !== 'string' || typeof branch !== 'string') return null

    return { path, branch }
  } catch {
    return null
  }
}

const linkedFrom = (body: string): LinkedPullRequestDto | null => {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== 'object' || parsed === null) return null

    const { number, url, repo, branch } = parsed as Record<string, unknown>
    if (typeof number !== 'number') return null
    if (typeof url !== 'string' || typeof repo !== 'string' || typeof branch !== 'string') {
      return null
    }

    return { number, url, repo, branch }
  } catch {
    return null
  }
}

type ForkLink = { parentThreadId: string; forkSeq: number } | null

async function referenceLink(args: { reader: SessionReader; threadId: string }): Promise<ForkLink> {
  const link = await args.reader.orm.public.Thread.where({ id: args.threadId })
    .select('parentThreadId', 'forkSeq', 'forkMode')
    .first()
  if (link === null || link.forkMode !== 'reference') return null
  if (link.parentThreadId === null || link.forkSeq === null) return null
  return { parentThreadId: link.parentThreadId, forkSeq: link.forkSeq }
}

export async function referenceThreadWorktree(args: {
  reader: SessionReader
  threadId: string
  upTo?: number | undefined
}): Promise<ThreadWorktreeDto | null> {
  let threadId = args.threadId
  let upTo = args.upTo

  for (let hop = 0; hop <= REFERENCE_CHAIN_LIMIT; hop += 1) {
    const scoped = args.reader.orm.public.Event.where((event) =>
      event.type.in(WORKTREE_EVENT_TYPES),
    ).where({ threadId })
    const bound = upTo
    const latest = await (bound === undefined
      ? scoped
      : scoped.where((event) => event.seq.lte(bound))
    )
      .select('type', 'body')
      .orderBy((event) => event.seq.desc())
      .first()
    if (latest !== null) {
      return latest.type === 'worktree-entered' ? enteredFrom(latest.body) : null
    }

    const link = await referenceLink({ reader: args.reader, threadId })
    if (link === null) return null

    threadId = link.parentThreadId
    upTo = upTo === undefined ? link.forkSeq : Math.min(upTo, link.forkSeq)
  }

  return null
}

export async function referenceThreadPullRequests(args: {
  reader: SessionReader
  threadId: string
  upTo?: number | undefined
}): Promise<LinkedPullRequestDto[]> {
  let threadId = args.threadId
  let upTo = args.upTo

  for (let hop = 0; hop <= REFERENCE_CHAIN_LIMIT; hop += 1) {
    const scoped = args.reader.orm.public.Event.where({
      threadId,
      type: PULL_REQUEST_EVENT_TYPE,
    })
    const bound = upTo
    const rows = await (bound === undefined
      ? scoped
      : scoped.where((event) => event.seq.lte(bound))
    )
      .select('body')
      .orderBy((event) => event.seq.asc())
      .all()
    if (rows.length > 0) {
      const byIdentity = new Map<string, LinkedPullRequestDto>()
      for (const row of rows) {
        const linked = linkedFrom(row.body)
        if (linked !== null) byIdentity.set(`${linked.repo}#${linked.number}`, linked)
      }
      return [...byIdentity.values()]
    }

    const link = await referenceLink({ reader: args.reader, threadId })
    if (link === null) return []

    threadId = link.parentThreadId
    upTo = upTo === undefined ? link.forkSeq : Math.min(upTo, link.forkSeq)
  }

  return []
}

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
  return threads.map((thread) => ({
    id: thread.id,
    title: titles.get(thread.id) ?? null,
  }))
}

export async function referenceSpawnedPullRequests(args: {
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
      spawned.map((thread) =>
        referenceThreadPullRequests({
          reader: args.reader,
          threadId: thread.id,
        }),
      ),
    )
    batches.forEach((pullRequests, index) => {
      const thread = spawned[index]
      if (thread === undefined) return
      for (const pullRequest of pullRequests) {
        found.push({
          ...pullRequest,
          via: { threadId: thread.id, title: thread.title },
        })
      }
    })
    frontier = spawned.map((thread) => thread.id)
  }

  return found
}

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

export async function threadWorktree(args: {
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

export async function threadPullRequests(args: {
  reader: SessionReader
  threadId: string
  upTo?: number | undefined
}): Promise<LinkedPullRequestDto[]> {
  let threadId = args.threadId
  let upTo = args.upTo

  for (let hop = 0; hop <= REFERENCE_CHAIN_LIMIT; hop += 1) {
    const scoped = args.reader.orm.public.Event.where({ threadId, type: PULL_REQUEST_EVENT_TYPE })
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

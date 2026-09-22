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

async function referenceLink(args: {
  reader: SessionReader
  threadId: string
}): Promise<ForkLink> {
  const link = await args.reader.thread.findUnique({
    where: { id: args.threadId },
    select: { parentThreadId: true, forkSeq: true, forkMode: true },
  })
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
    const latest = await args.reader.event.findFirst({
      where: {
        threadId,
        type: { in: [...WORKTREE_EVENT_TYPES] },
        ...(upTo === undefined ? {} : { seq: { lte: upTo } }),
      },
      orderBy: { seq: 'desc' },
      select: { type: true, body: true },
    })
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
    const rows = await args.reader.event.findMany({
      where: {
        threadId,
        type: PULL_REQUEST_EVENT_TYPE,
        ...(upTo === undefined ? {} : { seq: { lte: upTo } }),
      },
      orderBy: { seq: 'asc' },
      select: { body: true },
    })
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

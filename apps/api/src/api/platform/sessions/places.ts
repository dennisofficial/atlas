import type { LinkedPullRequestDto, ThreadCheckoutDto, ThreadWorktreeDto } from './sessions.types'
import type { SessionReader } from './fork-chain'
import { walkReferences } from './reference-walk'

const WORKTREE_EVENT_TYPES = ['worktree-entered', 'worktree-exited', 'directory-changed']
const CHECKOUT_EVENT_TYPE = 'checkout-observed'
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

const checkoutFrom = (body: string): ThreadCheckoutDto | null => {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== 'object' || parsed === null) return null

    const { path, branch, detached } = parsed as Record<string, unknown>
    if (typeof path !== 'string' || typeof detached !== 'boolean') return null
    if (typeof branch !== 'string' && branch !== null) return null

    return { path, branch, detached }
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

export function threadWorktrees(args: {
  reader: SessionReader
  threadIds: readonly string[]
}): Promise<Map<string, ThreadWorktreeDto | null>> {
  return walkReferences<ThreadWorktreeDto | null>({
    reader: args.reader,
    threadIds: args.threadIds,
    eventTypes: WORKTREE_EVENT_TYPES,
    fallback: () => null,
    pick: (events) => {
      const latest = events.at(-1)
      if (latest === undefined) return null
      return {
        value: latest.type === 'worktree-entered' ? enteredFrom(latest.body) : null,
      }
    },
  })
}

export function threadCheckouts(args: {
  reader: SessionReader
  threadIds: readonly string[]
}): Promise<Map<string, ThreadCheckoutDto | null>> {
  return walkReferences<ThreadCheckoutDto | null>({
    reader: args.reader,
    threadIds: args.threadIds,
    eventTypes: [CHECKOUT_EVENT_TYPE],
    fallback: () => null,
    pick: (events) => {
      const latest = events.at(-1)
      if (latest === undefined) return null
      return { value: checkoutFrom(latest.body) }
    },
  })
}

export function threadsPullRequests(args: {
  reader: SessionReader
  threadIds: readonly string[]
}): Promise<Map<string, LinkedPullRequestDto[]>> {
  return walkReferences<LinkedPullRequestDto[]>({
    reader: args.reader,
    threadIds: args.threadIds,
    eventTypes: [PULL_REQUEST_EVENT_TYPE],
    fallback: () => [],
    pick: (events) => {
      if (events.length === 0) return null
      const byIdentity = new Map<string, LinkedPullRequestDto>()
      for (const event of events) {
        const linked = linkedFrom(event.body)
        if (linked !== null) byIdentity.set(`${linked.repo}#${linked.number}`, linked)
      }
      return { value: [...byIdentity.values()] }
    },
  })
}

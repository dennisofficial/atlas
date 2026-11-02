import { displayedThreadTitle } from '@dltech/atlas-core'
import type { WireThread } from '@dltech/atlas-wire/web'

import { currentBranchOf, isOutsideGit } from './header-model'
import { pullRequestKeyOf, type PullRequestEntry } from './pull-request-entries'
import { UNTITLED } from './untitled'

export type CheckoutView = {
  key: string
  branch: string
  path: string | undefined
  label: string | undefined
  main: boolean
  threadIds: string[]
  rowKeys: string[]
}

export type SessionCheckouts = {
  checkouts: CheckoutView[]
  looseKeys: string[]
}

export const NO_CHECKOUTS: SessionCheckouts = { checkouts: [], looseKeys: [] }

const keyOf = (args: { branch: string; path: string | undefined }): string =>
  `${args.branch}\u0000${args.path ?? ''}`

export function checkoutOf(
  thread: WireThread,
): { branch: string; path: string | undefined } | undefined {
  if (isOutsideGit(thread)) return undefined
  const branch = currentBranchOf(thread)
  if (branch === undefined) return undefined
  return {
    branch,
    path: thread.checkout?.path ?? thread.worktree?.path ?? undefined,
  }
}

export function quietPathOf(args: {
  path: string | undefined
  root: WireThread
}): string | undefined {
  const { path, root } = args
  if (path === undefined || path === root.workspace || path === root.repo) return undefined
  return path
}

export function threadLabelOf(thread: WireThread): string {
  return thread.title ? displayedThreadTitle(thread.title) : UNTITLED
}

export function sessionCheckoutsOf(args: {
  thread: WireThread | undefined
  family: readonly WireThread[]
  entries: readonly PullRequestEntry[]
}): SessionCheckouts {
  const { thread, entries } = args
  if (thread === undefined) return NO_CHECKOUTS
  const views = new Map<string, CheckoutView>()
  const add = (member: WireThread, main: boolean) => {
    const checkout = checkoutOf(member)
    if (checkout === undefined) return
    const key = keyOf(checkout)
    const existing = views.get(key)
    if (existing !== undefined) {
      existing.threadIds.push(member.id)
      return
    }
    views.set(key, {
      key,
      ...checkout,
      label: main ? undefined : threadLabelOf(member),
      main,
      threadIds: [member.id],
      rowKeys: [],
    })
  }
  add(thread, true)
  for (const member of args.family) if (member.id !== thread.id) add(member, false)

  const all = [...views.values()]
  const main = all.find((view) => view.main)
  const looseKeys: string[] = []
  for (const entry of entries) {
    const key = pullRequestKeyOf(entry)
    const viaId = entry.via?.threadId
    let owner = viaId === undefined ? main : all.find((view) => view.threadIds.includes(viaId))
    if (owner === undefined && entry.via !== undefined) {
      owner = all.find((view) => view.branch === entry.branch)
      if (owner === undefined) {
        owner = {
          key: keyOf({ branch: entry.branch, path: viaId }),
          branch: entry.branch,
          path: undefined,
          label: undefined,
          main: false,
          threadIds: [entry.via.threadId],
          rowKeys: [],
        }
        all.push(owner)
      }
    }
    if (owner === undefined) looseKeys.push(key)
    else owner.rowKeys.push(key)
  }
  const checkouts =
    all.length > 1
      ? all.map((view) => ({
          ...view,
          path: quietPathOf({ path: view.path, root: thread }),
        }))
      : all.map((view) => ({ ...view, path: undefined }))
  return { checkouts, looseKeys }
}

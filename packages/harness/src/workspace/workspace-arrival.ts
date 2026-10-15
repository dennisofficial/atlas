import { isAbsolute, relative, resolve, sep } from 'node:path'

import {
  activeWorktreeOf,
  projectDirectoryOf,
  type ActiveWorktree,
  type EventDraft,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { ThreadStorePort } from '../store/thread-store'
import type { RestoredTree, RestoredWorkspace } from './transfer/manifest'
import { recordFamilyOwnershipArrival, validateFamilyArrival } from './family-arrival'

const within = (args: { path: string; root: string }): string | undefined => {
  const tail = relative(args.root, args.path)
  if (tail === '..' || tail.startsWith(`..${sep}`) || isAbsolute(tail)) return undefined
  return tail
}

export function restoredDirectoryOf(args: {
  source: string
  restored: RestoredWorkspace
}): { path: string; tree: RestoredTree | undefined } {
  const trees = [...args.restored.trees].sort((a, b) => b.sourcePath.length - a.sourcePath.length)
  for (const tree of trees) {
    const tail = within({ path: args.source, root: tree.sourcePath })
    if (tail !== undefined) return { path: resolve(tree.path, tail), tree }
  }
  return { path: args.restored.cwd, tree: undefined }
}

export function workspaceArrivalDrafts(args: {
  path: string
  tree?: RestoredTree | undefined
  repository: string | null
  home?: string | undefined
  active?: ActiveWorktree | null | undefined
}): EventDraft[] {
  const drafts: EventDraft[] = [
    { type: 'directory-changed', path: args.home ?? args.path, repo: args.repository },
  ]
  if (args.active !== undefined) {
    if (args.active !== null) drafts.push({ type: 'worktree-entered', ...args.active })
  } else if (args.tree !== undefined && args.tree.path !== args.repository) {
    drafts.push({ type: 'worktree-entered', path: args.tree.path, branch: args.tree.branch ?? 'HEAD', adopted: true })
    if (args.path !== args.tree.path) drafts.push({ type: 'directory-changed', path: args.path, repo: args.repository })
  }
  return drafts
}

export async function recordWorkspaceArrival(args: {
  threadId: ThreadId
  restored: RestoredWorkspace
  launchDirectory: string
  log: EventLogPort
  threads: ThreadStorePort
  ids: IdPort
  sessionDir?: string | undefined
}): Promise<void> {
  const family = await validateFamilyArrival(args)
  await recordFamilyOwnershipArrival(args)
  for (const threadId of family) {
    const thread = await args.threads.find({ threadId })
    const events = await args.log.readOwn({ threadId })
    const source = projectDirectoryOf({ events, launchDirectory: thread?.workspace ?? args.launchDirectory })
    const member = args.restored.family?.threads.find((entry) => entry.threadId === threadId)
    const directory = member !== undefined
      ? { path: member.active?.path ?? member.home, tree: args.restored.trees.find((tree) => tree.path === (member.active?.path ?? member.home)) }
      : threadId === args.threadId
        ? { path: args.restored.cwd, tree: restoredDirectoryOf({ source, restored: args.restored }).tree }
        : restoredDirectoryOf({ source, restored: args.restored })
    const active = activeWorktreeOf(events)
    const tree = threadId === args.threadId
      ? [...args.restored.trees].sort((a, b) => b.path.length - a.path.length).find((item) => within({ path: directory.path, root: item.path }) !== undefined)
      : directory.tree
    await args.threads.adopt({ threadId, workspace: member?.home ?? directory.path, repo: args.restored.repository })
    await args.log.append({
      threadId,
      runId: args.ids.nextRunId(),
      drafts: workspaceArrivalDrafts({
        path: directory.path,
        tree: tree === undefined || (active === undefined && tree.path === args.restored.repository) ? undefined : tree,
        repository: args.restored.repository,
        home: member?.home,
        active: member === undefined ? undefined : member.active === null ? null : { ...member.active, base: member.active.base ?? undefined },
      }),
    })
  }
}

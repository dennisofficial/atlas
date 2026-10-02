import { basename, isAbsolute, relative, resolve, sep } from 'node:path'

import {
  activeWorktreeOf,
  projectDirectoryOf,
  type EExecutionLocation,
  type EventDraft,
  type EventLogPort,
  type IdPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { ThreadStorePort } from '../../store/thread-store'
import type { RestoredTree, RestoredWorkspace } from '../../workspace/transfer/manifest'

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
  from: EExecutionLocation
  to: EExecutionLocation
  path: string
  tree?: RestoredTree | undefined
  repository: string | null
}): EventDraft[] {
  const drafts: EventDraft[] = [
    { type: 'location-changed', from: args.from, to: args.to, cwd: args.path },
    { type: 'directory-changed', path: args.path, repo: args.repository },
  ]
  if (args.tree !== undefined && args.tree.path !== args.repository) {
    drafts.push({ type: 'worktree-entered', path: args.tree.path, branch: args.tree.branch ?? 'HEAD', adopted: true })
    if (args.path !== args.tree.path) drafts.push({ type: 'directory-changed', path: args.path, repo: args.repository })
  }
  const renamed = args.tree?.renamedFrom
  const detail = renamed === null || renamed === undefined
    ? 'Your files and Git staging state were transferred without committing or merging them.'
    : `Your worktree was restored as ${basename(args.tree?.path ?? args.path)} because ${renamed} changed at the destination. The existing checkout was left untouched.`
  drafts.push({
    type: 'context-loaded',
    slot: 'session',
    key: 'execution-location',
    content: `Your environment is now ${args.to}. Your project directory is ${args.path}. ${detail}`,
  })
  return drafts
}

export async function recordWorkspaceArrival(args: {
  threadId: ThreadId
  from: EExecutionLocation
  to: EExecutionLocation
  restored: RestoredWorkspace
  launchDirectory: string
  log: EventLogPort
  threads: ThreadStorePort
  ids: IdPort
}): Promise<void> {
  const family = [args.threadId]
  for (const threadId of family) {
    const thread = await args.threads.find({ threadId })
    const events = await args.log.readOwn({ threadId })
    const source = projectDirectoryOf({ events, launchDirectory: thread?.workspace ?? args.launchDirectory })
    const directory = threadId === args.threadId
      ? { path: args.restored.cwd, tree: restoredDirectoryOf({ source, restored: args.restored }).tree }
      : restoredDirectoryOf({ source, restored: args.restored })
    const active = activeWorktreeOf(events)
    const tree = threadId === args.threadId
      ? [...args.restored.trees].sort((a, b) => b.path.length - a.path.length).find((item) => within({ path: directory.path, root: item.path }) !== undefined)
      : directory.tree
    await args.threads.adopt({ threadId, workspace: directory.path, repo: args.restored.repository })
    await args.log.append({
      threadId,
      runId: args.ids.nextRunId(),
      drafts: workspaceArrivalDrafts({
        from: args.from,
        to: args.to,
        path: directory.path,
        tree: tree === undefined || (active === undefined && tree.path === args.restored.repository) ? undefined : tree,
        repository: args.restored.repository,
      }),
    })
    const children = await args.threads.spawned({ threadId })
    family.push(...children.map((child) => child.id).filter((id) => !family.includes(id)))
  }
}

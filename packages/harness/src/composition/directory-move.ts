import { realpath } from 'node:fs/promises'

import type {
  ActiveWorktree,
  EventLogPort,
  IdPort,
  ThreadId,
  WorkspaceIdentity,
} from '@dltech/atlas-core'

import { probeWorkspace } from '../workspace/probe'
import type { ThreadStorePort } from '../store/thread-store'
import { releaseWorktree } from '../workspace/worktree-lock'

export type DirectoryMove = {
  path: string
  repo: string | null
}

export type DirectoryMovePorts = {
  log: Pick<EventLogPort, 'append'>
  ids: Pick<IdPort, 'nextRunId'>
  threads: Pick<ThreadStorePort, 'adopt'>
  threadOpened: (args: { threadId: ThreadId; projectDirectory: string }) => Promise<void>
}

export async function moveTowards(args: {
  path: string
}): Promise<DirectoryMove> {
  const canonical = await realpath(args.path).catch(() => args.path)
  const identity: WorkspaceIdentity = await probeWorkspace({ cwd: canonical })
  return { path: identity.workspace, repo: identity.repo }
}

/**
 * The session-behavior core of a directory move: the `directory-changed` event is how every
 * surface — the terminal that typed it, a serve thread resumed elsewhere, the next attach —
 * learns where the session now works, and the thread row and open hooks follow the same move.
 * The picker's argument handling and its refusals are the surface's; this part is not.
 */
export async function applyDirectoryMove(args: {
  app: DirectoryMovePorts
  threadId: ThreadId
  move: DirectoryMove
  activeWorktree: ActiveWorktree | null
}): Promise<void> {
  const { app, threadId, move, activeWorktree } = args

  if (activeWorktree !== null) {
    const left = await probeWorkspace({ cwd: activeWorktree.path })
    if (left.repo !== null) {
      await releaseWorktree({ cwd: left.repo, path: activeWorktree.path }).catch(() => false)
    }
  }

  await app.log.append({
    threadId,
    runId: app.ids.nextRunId(),
    drafts: [{ type: 'directory-changed', path: move.path, repo: move.repo }],
  })
  await app.threads.adopt({ threadId, workspace: move.path, repo: move.repo })
  await app.threadOpened({ threadId, projectDirectory: move.path })
}

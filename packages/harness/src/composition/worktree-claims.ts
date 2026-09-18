import { ENoticeTone, NOTICE_WARN_MS, type EventLogPort, type IdPort, type NoticePort, type ThreadId, type WorkspaceIdentity } from '@dltech/atlas-core'

import type { DependencyContainer } from '../container/injection'
import { registerDisposable } from '../container/disposal'
import { HookChainToken } from '../container/tokens'
import type { ThreadStorePort } from '../store/thread-store'
import {
  claimWorktree,
  claimWorktreeAt,
  EWorktreeClaim,
  releaseWorktree,
} from '../workspace/worktree-lock'

const SESSION_CLAIM_LABEL = 'session'

const releasedOnClose = new Set<string>()

function releaseWorktreeOnClose(args: {
  container: DependencyContainer
  repo: string
  path: string
}): void {
  if (releasedOnClose.has(args.path)) return
  releasedOnClose.add(args.path)

  registerDisposable({
    container: args.container,
    close: async () => {
      await releaseWorktree({ cwd: args.repo, path: args.path })
    },
  })
}

export async function claimLaunchWorktree(args: {
  container: DependencyContainer
  workspace: WorkspaceIdentity
}): Promise<void> {
  const path = args.workspace.workspace
  const repo = args.workspace.repo
  if (repo === null || repo === path) return

  const claimed = await claimWorktree({ cwd: repo, path, label: SESSION_CLAIM_LABEL }).catch(
    () => undefined,
  )
  if (claimed?.claim !== EWorktreeClaim.Owned && claimed?.claim !== EWorktreeClaim.Reclaimed) return

  releaseWorktreeOnClose({ container: args.container, repo, path })
}

/**
 * A resumed thread's worktree is folded back out of its event log, so nothing re-locks it for the
 * process that picked the thread up — the lock still names the process that entered it, which may
 * be long dead. Every thread open re-claims it; a stale lock is cleared and retaken, a live one is
 * reported, and the claim is handed back when the app closes.
 */
export async function claimOpenedWorktree(args: {
  container: DependencyContainer
  threadId: ThreadId
  projectDirectory: string
  notice: NoticePort
}): Promise<void> {
  const claimed = await claimWorktreeAt({
    cwd: args.projectDirectory,
    label: `thread ${args.threadId}`,
  }).catch(() => undefined)
  if (claimed === undefined) return

  if (claimed.outcome.claim === EWorktreeClaim.Held) {
    args.notice.notify({
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
      text: `This thread's worktree is locked by another running Atlas session (pid ${claimed.outcome.heldBy ?? 'unknown'}); this one is working in it as a guest.`,
    })
    return
  }

  if (claimed.outcome.claim === EWorktreeClaim.Reclaimed) {
    args.notice.notify({
      tone: ENoticeTone.Info,
      text: 'That worktree was left locked by an Atlas session that is no longer running; the stale lock was cleared.',
    })
  }

  if (
    claimed.outcome.claim !== EWorktreeClaim.Owned &&
    claimed.outcome.claim !== EWorktreeClaim.Reclaimed
  ) {
    return
  }

  releaseWorktreeOnClose({ container: args.container, repo: claimed.repo, path: claimed.path })
}

/**
 * Drafts append only to a thread the store already knows: a conversation nobody has spoken in
 * is opened by its first turn, and an OnThreadOpen draft must not open it early.
 */
export function threadOpenedHandler(args: {
  container: DependencyContainer
  log: EventLogPort
  threads: ThreadStorePort
  ids: IdPort
  notice: NoticePort
}): (opened: { threadId: ThreadId; projectDirectory: string }) => Promise<void> {
  return async ({ threadId, projectDirectory }) => {
    await claimOpenedWorktree({
      container: args.container,
      threadId,
      projectDirectory,
      notice: args.notice,
    })

    const chain = args.container.resolve(HookChainToken)
    const drafts = await chain.onThreadOpen({ threadId, projectDirectory })
    if (drafts.length === 0) return
    if ((await args.threads.find({ threadId })) === undefined) return

    await args.log.append({ threadId, runId: args.ids.nextRunId(), drafts })
  }
}

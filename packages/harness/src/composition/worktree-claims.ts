import { ENoticeTone, NOTICE_WARN_MS, projectDirectoryOf, type IdPort, type NoticePort, type ThreadId, type WorkspaceIdentity } from '@dltech/atlas-core'

import { portToken, resolveIfPossible, type DependencyContainer } from '../container/injection'
import { EventLogPort } from '@dltech/atlas-core'
import { registerDisposable } from '../container/disposal'
import { HookChainToken } from '../container/tokens'
import type { ThreadStorePort } from '../store/thread-store'
import { probeWorkspace } from '../workspace/probe'
import {
  claimWorktree,
  claimWorktreeAt,
  EWorktreeClaim,
  releaseWorktree,
} from '../workspace/worktree-lock'

const SESSION_CLAIM_LABEL = 'session'

const heldWarned = new Set<string>()
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

async function sharesSpawnerWorktree(args: {
  threads: ThreadStorePort
  log?: Pick<EventLogPort, 'readOwn'> | undefined
  threadId: ThreadId
  projectDirectory: string
}): Promise<boolean> {
  const opened = await args.threads.find({ threadId: args.threadId })
  const spawnerId = opened?.agent?.spawnedBy
  if (spawnerId === undefined) return false

  const spawner = await args.threads.find({ threadId: spawnerId })
  if (spawner?.workspace === null || spawner?.workspace === undefined) return false

  const events = args.log === undefined ? [] : await args.log.readOwn({ threadId: spawnerId })
  return projectDirectoryOf({ events, launchDirectory: spawner.workspace }) === args.projectDirectory
}

export async function releaseEndedWorktree(args: {
  threads: ThreadStorePort
  log?: Pick<EventLogPort, 'readOwn'> | undefined
  threadId: ThreadId
}): Promise<void> {
  const ended = await args.threads.find({ threadId: args.threadId })
  const launchDirectory = ended?.workspace
  if (launchDirectory === null || launchDirectory === undefined) return
  const events = args.log === undefined ? [] : await args.log.readOwn({ threadId: args.threadId })
  const workspace = projectDirectoryOf({ events, launchDirectory })
  if (await sharesSpawnerWorktree({ threads: args.threads, log: args.log, threadId: args.threadId, projectDirectory: workspace })) return

  const identity = await probeWorkspace({ cwd: workspace }).catch(() => undefined)
  if (identity === undefined || identity.repo === null || identity.workspace === identity.repo) return

  await releaseWorktree({ cwd: identity.repo, path: identity.workspace })
}

export async function claimOpenedWorktree(args: {
  container: DependencyContainer
  threads: ThreadStorePort
  log?: Pick<EventLogPort, 'readOwn'> | undefined
  threadId: ThreadId
  projectDirectory: string
  notice: NoticePort
}): Promise<void> {
  const log = args.log ?? resolveIfPossible({ container: args.container, token: portToken(EventLogPort) })
  if (await sharesSpawnerWorktree({ ...args, log })) return

  const claimed = await claimWorktreeAt({
    cwd: args.projectDirectory,
    label: `thread ${args.threadId}`,
  }).catch(() => undefined)
  if (claimed === undefined) return

  if (claimed.outcome.claim === EWorktreeClaim.Held) {
    if (heldWarned.has(args.projectDirectory)) return
    heldWarned.add(args.projectDirectory)

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
      threads: args.threads,
      threadId,
      projectDirectory,
      notice: args.notice,
      log: args.log,
    })

    const chain = args.container.resolve(HookChainToken)
    const drafts = await chain.onThreadOpen({ threadId, projectDirectory })
    if (drafts.length === 0) return
    if ((await args.threads.find({ threadId })) === undefined) return

    await args.log.append({ threadId, runId: args.ids.nextRunId(), drafts })
  }
}

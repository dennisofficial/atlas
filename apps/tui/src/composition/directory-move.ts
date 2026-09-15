import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

import { EExecutionLocation, type ActiveWorktree, type ThreadId } from '@dltech/atlas-core'
import { probeWorkspace, releaseWorktree } from '@dltech/atlas-harness'

import { expandHome } from '../ui/paths'
import { ECommandEffect, type CommandEffect } from './commands/local-command'
import type { AtlasApp } from './compose'
import { stateOfDirectory, workspaceRefusal } from './workspace-directory'

export type DirectoryMove = {
  path: string
  repo: string | null
}

export const cdTargetOf = (args: { argument: string; current: string }): string =>
  resolve(args.current, expandHome({ path: args.argument.trim(), home: homedir() }))

export const directoryRefusal = (path: string): string | null =>
  workspaceRefusal({ directory: path, state: stateOfDirectory(path) })

export const IN_A_CONTAINER =
  '/cd moves the session on the host — this conversation runs in a container, where the directory is fixed. /container off first'

export const currentDirectoryNotice = (path: string): string =>
  `this session is working in ${path}`

export const movedDirectoryNotice = (path: string): string =>
  `this session now works in ${path}`

export const alreadyThereNotice = (path: string): string => `already working in ${path}`

export async function moveTowards({ path }: { path: string }): Promise<DirectoryMove> {
  const canonical = await realpath(path).catch(() => path)
  const identity = await probeWorkspace({ cwd: canonical })
  return { path: identity.workspace, repo: identity.repo }
}

export type MovePorts = Pick<AtlasApp, 'log' | 'ids' | 'threads' | 'threadOpened'>

export async function applyDirectoryMove(args: {
  app: MovePorts
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
    drafts: [{ type: 'directory-changed', path: move.path }],
  })
  await app.threads.adopt({ threadId, workspace: move.path, repo: move.repo })
  await app.threadOpened({ threadId, projectDirectory: move.path })
}

const refused = (reason: string): CommandEffect => ({ type: ECommandEffect.Refused, reason })

const ran = (notice: string): CommandEffect => ({ type: ECommandEffect.Ran, notice })

export async function changeDirectory(args: {
  app: MovePorts & Pick<AtlasApp, 'executionLocation' | 'workspace'>
  threadId: ThreadId
  started: boolean
  workspace: { projectDirectory: string; activeWorktree: ActiveWorktree | null }
  holdMove: (move: DirectoryMove | null) => void
  refresh: () => Promise<void>
  argumentText: string
}): Promise<CommandEffect> {
  const { app, threadId, started, workspace, holdMove, refresh } = args

  const argument = args.argumentText.trim()
  const current = workspace.projectDirectory
  if (argument === '') return ran(currentDirectoryNotice(current))

  if (app.executionLocation.current() === EExecutionLocation.Docker) {
    return refused(IN_A_CONTAINER)
  }

  const target = cdTargetOf({ argument, current })
  const badDirectory = directoryRefusal(target)
  if (badDirectory !== null) return refused(badDirectory)

  const move = await moveTowards({ path: target })
  if (move.path === current) return ran(alreadyThereNotice(current))

  if (!started) {
    holdMove(move.path === app.workspace.workspace ? null : move)
    void app.threadOpened({ threadId, projectDirectory: move.path }).catch(() => undefined)
    return ran(movedDirectoryNotice(move.path))
  }

  try {
    await applyDirectoryMove({ app, threadId, move, activeWorktree: workspace.activeWorktree })
  } catch (error) {
    return refused(
      `/cd could not move this session: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  holdMove(null)
  await refresh().catch(() => undefined)
  return ran(movedDirectoryNotice(move.path))
}

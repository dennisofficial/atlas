import type { Event, ThreadId } from '@dltech/atlas-core'
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'

import type { LogSummary } from '../store/log-window'
import type { CommandEffect } from './commands/local-command'
import type { AtlasApp } from './compose'
import type { ConversationWorkspace } from './conversation-types'
import { changeDirectory, type DirectoryMove } from './directory-move'
import type { OpenedConversation } from './open-conversation'
import { terminalTitleSequence } from './terminal-title'

export function usePendingMove(): {
  pendingMove: DirectoryMove | null
  pendingMoveRef: RefObject<DirectoryMove | null>
  holdMove: (move: DirectoryMove | null) => void
} {
  const [pendingMove, setPendingMove] = useState<DirectoryMove | null>(null)
  const pendingMoveRef = useRef<DirectoryMove | null>(null)

  const holdMove = useCallback((move: DirectoryMove | null): void => {
    pendingMoveRef.current = move
    setPendingMove(move)
  }, [])

  return { pendingMove, pendingMoveRef, holdMove }
}

export function useConversationDirectory(args: {
  app: AtlasApp
  threadId: ThreadId
  opened: OpenedConversation
  name: string | null
  started: boolean
  events: readonly Event[]
  logSummary: LogSummary
  pendingMove: DirectoryMove | null
  holdMove: (move: DirectoryMove | null) => void
  refresh: () => Promise<void>
}): {
  workspace: ConversationWorkspace
  handleChangeDirectory: (argumentText: string) => Promise<CommandEffect>
} {
  const { app, threadId, opened, name, started, events, logSummary, pendingMove, holdMove, refresh } =
    args

  useEffect(() => {
    void app.threadOpened({
      threadId: opened.threadId,
      projectDirectory:
        logSummary.worktree?.path ?? logSummary.home ?? app.workspace.workspace,
    })
  }, [app, opened, logSummary, app.workspace.workspace])

  const workspace = useMemo((): ConversationWorkspace => {
    const launchDirectory = app.workspace.workspace
    if (pendingMove !== null && events.length === 0) {
      return { projectDirectory: pendingMove.path, activeWorktree: null, repo: pendingMove.repo }
    }
    return {
      projectDirectory: logSummary.worktree?.path ?? logSummary.home ?? launchDirectory,
      activeWorktree: logSummary.worktree ?? null,
      repo: logSummary.repo ?? app.workspace.repo,
    }
  }, [events, pendingMove, logSummary, app.workspace.workspace, app.workspace.repo])

  const handleChangeDirectory = useCallback(
    (argumentText: string): Promise<CommandEffect> =>
      changeDirectory({
        app,
        threadId,
        started,
        workspace,
        holdMove,
        refresh,
        argumentText,
      }),
    [app, holdMove, refresh, started, threadId, workspace],
  )

  useEffect(() => {
    process.stdout.write(
      terminalTitleSequence({ name, directory: workspace.projectDirectory }),
    )
    app.journalResume({
      active: { threadId, title: name, started },
      directory: workspace.projectDirectory,
    })
  }, [app, name, started, threadId, workspace.projectDirectory])

  return { workspace, handleChangeDirectory }
}

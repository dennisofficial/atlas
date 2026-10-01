import { useTerminalDimensions } from '@opentui/react'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import type { ThreadId } from '@dltech/atlas-core'

import { isWaiting, type BackgroundWork } from '../ui/background-wait'
import { composerEdgeVersion, subscribeComposerEdge } from '../ui/composer-edge-store'
import { densityVersion, subscribeDensity } from '../ui/density-store'
import { useDiffStat } from '../ui/hooks/use-diff-stat'
import { useSince } from '../ui/hooks/use-since'
import { useTerminalFocus } from '../ui/hooks/use-terminal-focus'
import { clearNotice, NOTICE_KEY_LOST_AGENTS } from '../ui/notice-store'
import { paletteVersion, subscribePalette } from '../ui/palette-store'
import {
  chromeWidthOf,
  contentWidthOf,
  peekInForce,
  sidebarLayout,
  sidebarShown,
  ESidebarLayout,
} from '../ui/sidebar-visibility'
import { hasLostChildren } from '../ui/lost-children-model'
import { welcomeCells, welcoming } from '../ui/welcome-state'
import type { useAgents } from './use-agents'
import type { Conversation } from './use-conversation'
import type { SettingsControl } from './use-settings'
import type { useShells } from './use-shells'
import { EChromePanel } from './workspace-panels'

const repoNameOf = (args: { repo: string | null; projectDirectory: string }): string => {
  const segments = (args.repo ?? args.projectDirectory).split('/').filter((segment) => segment !== '')
  return segments[segments.length - 1] ?? args.projectDirectory
}

export function useWorkspaceFrame(args: {
  settings: Pick<SettingsControl, 'sidebarWidth' | 'sidebarFoldBelow'>
}) {
  const { sidebarWidth, sidebarFoldBelow } = args.settings
  const { width, height } = useTerminalDimensions()
  useSyncExternalStore(subscribePalette, paletteVersion)
  useSyncExternalStore(subscribeDensity, densityVersion)
  useSyncExternalStore(subscribeComposerEdge, composerEdgeVersion)

  const [peeking, setPeeking] = useState(false)
  const sidebarMode = sidebarLayout({ width, foldBelow: sidebarFoldBelow, sidebarWidth })
  const wide = sidebarMode === ESidebarLayout.Wide

  const handleToggleSidebar = useCallback(() => setPeeking((open) => !open), [])

  const handleClosePeek = useCallback(() => setPeeking(false), [])

  useEffect(() => {
    setPeeking((open) => peekInForce({ layout: sidebarMode, peeking: open }))
  }, [sidebarMode])

  return {
    width,
    height,
    sidebarWidth,
    sidebarMode,
    peeking,
    wide,
    handleToggleSidebar,
    handleClosePeek,
  }
}

export type WorkspaceFrame = ReturnType<typeof useWorkspaceFrame>

export function useChromePanel(args: { lost: Conversation['lost'] }) {
  const { lost } = args
  const [panel, setPanel] = useState<EChromePanel | null>(null)

  const handleShortcuts = useCallback(() => setPanel(EChromePanel.Shortcuts), [])

  const handleShowAgentTypes = useCallback(() => setPanel(EChromePanel.AgentTypes), [])

  const handleDismissPanel = useCallback(() => setPanel(null), [])

  const handleShowLostAgents = useCallback((): boolean => {
    if (!hasLostChildren(lost)) return false

    clearNotice({ key: NOTICE_KEY_LOST_AGENTS })
    setPanel(EChromePanel.LostAgents)
    return true
  }, [lost])

  return { panel, handleShortcuts, handleShowAgentTypes, handleDismissPanel, handleShowLostAgents }
}

export function useBackgroundWait(args: {
  agents: Pick<ReturnType<typeof useAgents>, 'running'>
  shells: Pick<ReturnType<typeof useShells>, 'running'>
}) {
  const background = useMemo(
    (): BackgroundWork => ({ agents: args.agents.running, shells: args.shells.running }),
    [args.agents.running, args.shells.running],
  )
  const waitingSince = useSince(isWaiting(background))

  return { background, waitingSince }
}

export function useWorkspaceLayout(args: {
  frame: Pick<WorkspaceFrame, 'width' | 'sidebarWidth' | 'sidebarMode' | 'peeking' | 'wide'>
  conversation: Pick<
    Conversation,
    'model' | 'repo' | 'projectDirectory' | 'activeWorktree' | 'working' | 'mutations'
  >
  addressing: ThreadId | null
}) {
  const { frame, conversation, addressing } = args
  const { width, sidebarWidth, wide } = frame

  const welcome = welcoming({ model: conversation.model, addressingChild: addressing !== null })
  const sidebarVisible = !welcome && sidebarShown({ layout: frame.sidebarMode, peeking: frame.peeking })
  const overlay = sidebarVisible && !wide

  const repoRoot = conversation.repo ?? conversation.projectDirectory
  const sidebarWorktree =
    conversation.activeWorktree?.path ??
    (conversation.projectDirectory.startsWith(`${repoRoot}/`) ? conversation.projectDirectory : null)
  const projectRoot = sidebarWorktree === null ? conversation.projectDirectory : repoRoot
  const repoName = repoNameOf({ repo: conversation.repo, projectDirectory: conversation.projectDirectory })
  const headerDiff = useDiffStat({
    projectDirectory: conversation.projectDirectory,
    working: conversation.working,
    focus: useTerminalFocus(),
    mutations: conversation.mutations,
  })
  const docked = wide && !welcome
  const contentWidth = contentWidthOf({ width, sidebarWidth, docked })
  const chromeWidth = chromeWidthOf({ width, sidebarWidth, docked })
  const composerWidth = welcome ? welcomeCells({ width: chromeWidth }) : chromeWidth

  return {
    welcome,
    sidebarVisible,
    overlay,
    repoRoot,
    projectRoot,
    repoName,
    sidebarWorktree,
    headerDiff,
    contentWidth,
    chromeWidth,
    composerWidth,
  }
}

export type WorkspaceLayout = ReturnType<typeof useWorkspaceLayout>

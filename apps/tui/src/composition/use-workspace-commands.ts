import { useCallback, useMemo, useState } from 'react'

import { mcpReport, type DiscoveredSkill, type EConnectionView } from '@dltech/atlas-harness'

import type { AtlasApp } from './compose'
import { localCommands, type EContainerAsk } from './commands'
import { wakeEffect } from './commands/wake'
import type { Conversation } from './use-conversation'
import { reloadedSkills, type SkillsReloaded } from './skills-reload'
import type { RewindControl } from './use-rewind'
import type { SettingsControl } from './use-settings'
import type { ShellsControl } from './use-shells'
import type { SwitcherControl } from './use-switcher'
import type { useChromePanel } from './use-workspace-layout'
import type { EExecutionLocation } from '@dltech/atlas-core'

export function useWorkspaceCommands(args: {
  app: AtlasApp
  onRestart: (() => void) | null
  cloud: { view: EConnectionView | null; wake: (() => void) | null }
  conversation: Pick<
    Conversation,
    'handleChangeDirectory' | 'handleCompact' | 'handleRename' | 'handleRotate'
  >
  rewind: Pick<RewindControl, 'handleOpen'>
  settings: Pick<SettingsControl, 'handleOpen'>
  shells: ShellsControl
  switcher: Pick<SwitcherControl, 'handleOpen'>
  chrome: Pick<ReturnType<typeof useChromePanel>, 'handleShortcuts'>
  handleContainer: (asked: EExecutionLocation | EContainerAsk) => string | undefined
  handleContainerResources: () => string | undefined
  handleOpenAccounts: () => void
  handleNewConversation: () => void
  handleResumeConversation: (handle: string) => void
  handleRestart: () => void
  handleQuit: () => void
  quitDetaches: boolean
}) {
  const {
    app,
    onRestart,
    cloud,
    conversation,
    rewind,
    settings,
    shells,
    switcher,
    chrome,
    handleContainer,
    handleContainerResources,
    handleOpenAccounts,
    handleNewConversation,
    handleResumeConversation,
    handleRestart,
    handleQuit,
    quitDetaches,
  } = args

  const { view: cloudView, wake: wakeCloud } = cloud

  const [loadedSkills, setLoadedSkills] = useState<readonly DiscoveredSkill[]>(() =>
    app.skillRegistry.all(),
  )

  const handleReloadSkills = useCallback(async (): Promise<SkillsReloaded> => {
    const before = app.skillRegistry.all()
    const after = await app.skillRegistry.reload()
    setLoadedSkills(after)
    return reloadedSkills({ before, after })
  }, [app.skillRegistry])

  const commands = useMemo(() => {
    const { mcpSignIn } = app

    return localCommands({
      onChangeDirectory: conversation.handleChangeDirectory,
      onContainer: handleContainer,
      onContainerResources: handleContainerResources,
      onCompact: conversation.handleCompact,
      onRotate: conversation.handleRotate,
      onRewind: rewind.handleOpen,
      onShortcuts: chrome.handleShortcuts,
      onOpenSwitcher: () => switcher.handleOpen(),
      onOpenShells: () => shells.handleOpen(),
      onOpenSettings: settings.handleOpen,
      onOpenAccounts: handleOpenAccounts,
      onNewConversation: handleNewConversation,
      onOpenThreads: handleResumeConversation,
      onRename: conversation.handleRename,
      onReloadSkills: handleReloadSkills,
      onShowMcp: () => mcpReport({ servers: app.mcp() }),
      onMcpSignIn:
        mcpSignIn === undefined
          ? null
          : async (serverName: string) => (await mcpSignIn({ serverName })).detail,
      onRestart: onRestart === null ? null : handleRestart,
      onWake: () => wakeEffect({ view: cloudView, wake: wakeCloud }),
      onQuit: handleQuit,
      quitDetaches,
    })
  }, [
    chrome.handleShortcuts,
    conversation.handleChangeDirectory,
    conversation.handleCompact,
    conversation.handleRename,
    conversation.handleRotate,
    handleContainer,
    handleContainerResources,
    handleNewConversation,
    handleOpenAccounts,
    handleQuit,
    quitDetaches,
    handleReloadSkills,
    handleRestart,
    app,
    cloudView,
    wakeCloud,
    onRestart,
    rewind.handleOpen,
    settings.handleOpen,
    shells,
    switcher.handleOpen,
    handleResumeConversation,
  ])

  return { commands, loadedSkills }
}

import { useCallback, useMemo, useState } from 'react'

import { mcpReport, type DiscoveredSkill } from '@dltech/atlas-harness'

import type { AtlasApp } from './compose'
import { localCommands, type EContainerAsk } from './commands'
import type { Conversation } from './use-conversation'
import { reloadedSkills, type SkillsReloaded } from './skills-reload'
import type { AgentsPickerControl } from './use-agents-picker'
import type { RewindControl } from './use-rewind'
import type { SettingsControl } from './use-settings'
import type { ShellsControl } from './use-shells'
import type { SwitcherControl } from './use-switcher'
import type { useChromePanel } from './use-workspace-layout'
import type { EExecutionLocation } from '@dltech/atlas-core'

export function useWorkspaceCommands(args: {
  app: AtlasApp
  onRestart: (() => void) | null
  conversation: Pick<Conversation, 'handleChangeDirectory' | 'handleCompact' | 'handleRename'>
  rewind: Pick<RewindControl, 'handleOpen'>
  settings: Pick<SettingsControl, 'handleOpen'>
  shells: ShellsControl
  agentsPicker: Pick<AgentsPickerControl, 'handleOpen'>
  switcher: Pick<SwitcherControl, 'handleOpen'>
  chrome: Pick<
    ReturnType<typeof useChromePanel>,
    'handleShortcuts' | 'handleShowAgentTypes' | 'handleShowLostAgents'
  >
  handleContainer: (asked: EExecutionLocation | EContainerAsk) => string | undefined
  handleOpenAccounts: () => void
  handleNewConversation: () => void
  handleResumeConversation: (handle: string) => void
  handleRestart: () => void
  handleQuit: () => void
}) {
  const {
    app,
    onRestart,
    conversation,
    rewind,
    settings,
    shells,
    agentsPicker,
    switcher,
    chrome,
    handleContainer,
    handleOpenAccounts,
    handleNewConversation,
    handleResumeConversation,
    handleRestart,
    handleQuit,
  } = args

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
      onCompact: conversation.handleCompact,
      onRewind: rewind.handleOpen,
      onShortcuts: chrome.handleShortcuts,
      onOpenSwitcher: () => switcher.handleOpen(),
      onOpenShells: () => shells.handleOpen(),
      onOpenAgents: agentsPicker.handleOpen,
      onShowAgentTypes: chrome.handleShowAgentTypes,
      onShowLostAgents: chrome.handleShowLostAgents,
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
      onQuit: handleQuit,
    })
  }, [
    agentsPicker.handleOpen,
    chrome.handleShortcuts,
    chrome.handleShowAgentTypes,
    chrome.handleShowLostAgents,
    conversation.handleChangeDirectory,
    conversation.handleCompact,
    conversation.handleRename,
    handleContainer,
    handleNewConversation,
    handleOpenAccounts,
    handleQuit,
    handleReloadSkills,
    handleRestart,
    app,
    onRestart,
    rewind.handleOpen,
    settings.handleOpen,
    shells,
    switcher.handleOpen,
    handleResumeConversation,
  ])

  return { commands, loadedSkills }
}

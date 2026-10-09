import React from 'react'

import { useWorkspaceContext, WorkspaceContextPane } from './workspace-context'
import { workspaceHeader } from './workspace-header'
import { useWorkspaceQualityHealth } from './use-workspace-quality-health'
import { useCopyOnSelect } from '../ui/selection/use-copy-on-select'
import { useComposerPaste } from './use-composer-paste'
import { useModelChecks } from './use-model-checks'
import { useServices } from './use-services'
import { useSettings } from './use-settings'
import { useShells } from './use-shells'
import { useWorkspaceAccounts } from './use-workspace-accounts'
import { useWorkspaceAgents } from './use-workspace-agents'
import { useWorkspaceComposer } from './use-workspace-composer'
import { useWorkspaceExit } from './use-workspace-exit'
import { useWorkspaceFooter } from './use-workspace-footer'
import { useWorkspaceInput } from './use-workspace-input'
import { useChromePanel, useWorkspaceFrame, useWorkspaceLayout } from './use-workspace-layout'
import { useModelChoiceRelay, useWorkspaceModels } from './use-workspace-models'
import { useWorkspaceNaming } from './use-workspace-naming'
import { useWorkspaceNavigation } from './use-workspace-navigation'
import { useWorkspaceNotices } from './use-workspace-notices'
import { useWorkspaceCommands } from './use-workspace-commands'
import { useWorkspaceLifecycle } from './use-workspace-lifecycle'
import { useContainerResources } from './use-container-resources'
import { useWorkspaceLocation } from './use-workspace-location'
import { useWorkspacePlacement } from './use-workspace-placement'
import { useWorkspaceSession } from './use-workspace-session'
import { OverlayStack } from './overlay-stack'
import { WorkspaceChrome } from './workspace-chrome'
import type { WorkspaceProps } from './workspace-props'
import { WorkspaceSidebar } from './workspace-sidebar'
import { WorkspaceTranscript } from './workspace-transcript'
import { WorkspaceView } from './workspace-view'

export function Workspace(props: WorkspaceProps): React.ReactNode {
  const exit = useWorkspaceExit({ props })
  const { exitGuard } = exit
  const relay = useModelChoiceRelay()

  const settings = useSettings({ app: props.app, onChooseModel: relay.handleChoose })
  useModelChecks(props.app)
  useCopyOnSelect()

  const session = useWorkspaceSession({ props, settings, exit })
  const { draft, tokens, conversation, containerMove } = session

  const frame = useWorkspaceFrame({ settings })
  const models = useWorkspaceModels({
    app: props.app,
    cloudStores: props.cloudStores,
    settings,
    conversation,
    relay,
  })
  const { selection, switcher } = models
  const placement = useWorkspacePlacement({
    app: props.app,
    localApp: props.localApp,
    opened: props.opened,
    createBridge: props.createBridge,
    onReload: props.onReload,
    cloudSession: props.cloudSession,
    conversation,
  })

  const shells = useShells({ app: props.app, threadId: conversation.threadId })
  const services = useServices({ app: props.app })
  const contextBrowser = useWorkspaceContext({
    readers: props.attachment?.context, threadId: conversation.threadId, onClosePeek: frame.handleClosePeek,
  })

  useWorkspaceNotices({
    app: props.app,
    conversation,
    noticeSeconds: settings.noticeSeconds,
  })
  const chrome = useChromePanel({ lost: conversation.lost })

  const { agentView, viewed, agents, agentsPicker, background, waitingSince } = useWorkspaceAgents({
    app: props.app,
    conversation,
    shells,
    selection,
    meters: models.meters,
    viewedPicker: models.viewedPicker,
    onFocusComposer: session.handleFocusComposer,
  })

  const qualityHealth = useWorkspaceQualityHealth({ app: props.app, agentView, conversationThreadId: conversation.threadId, settings })

  const layout = useWorkspaceLayout({
    frame,
    conversation,
    addressing: agentView.addressing,
  })
  const sidebarNaming = useWorkspaceNaming({ conversation })

  const navigation = useWorkspaceNavigation({ props, conversation, draft, tokens, containerMove })
  const { threads, rewind } = navigation

  const { whatsNew } = props
  const { accounts, accountMeters, handleOpenAccounts, onboarding } =
    useWorkspaceAccounts({
      app: props.app,
      credentialNotice: props.credentialNotice,
      usageWarn: settings.usageWarn,
      onChooseModel: relay.handleChoose,
    })

  const containerResources = useContainerResources({
    readResources: () => {
      if (props.cloudBridge === null) return Promise.resolve({})
      return props.cloudBridge.sandboxes.readResources({ threadId: conversation.threadId })
    },
    updateResources: async (vcpus) => {
      if (props.cloudBridge === null) throw new Error('no cloud bridge attached')
      await props.cloudBridge.sandboxes.updateResources({ threadId: conversation.threadId, vcpus })
    },
  })
  const { containerGuard, handleContainer, handleContainerResources } = useWorkspaceLocation({
    props,
    conversation,
    execution: placement.execution,
    containerMove,
    containerResources,
    shells,
  })
  const { handleRestart, handleQuit } = useWorkspaceLifecycle({
    props,
    conversation,
    draft,
    containerMove,
    containerGuard,
    shells,
    agents,
    services,
    exit,
    autoRestart: settings.autoRestart,
  })
  const { commands, loadedSkills } = useWorkspaceCommands({
    app: props.app,
    onRestart: props.onRestart,
    conversation,
    rewind,
    settings,
    shells,
    agentsPicker,
    switcher,
    chrome,
    handleContainer,
    handleContainerResources,
    handleRestart,
    handleQuit,
    handleOpenAccounts,
    handleNewConversation: session.handleNewConversation,
    handleResumeConversation: navigation.handleResumeConversation,
  })

  const composer = useWorkspaceComposer({
    app: props.app,
    draft,
    tokens,
    conversation,
    agentView,
    commands,
    loadedSkills,
    handleOpenNewest: session.handleOpenNewest,
  })

  const footer = useWorkspaceFooter({
    app: props.app,
    draft,
    shells,
    services,
    agents,
    agentsPicker,
    chromeWidth: layout.chromeWidth,
    selection,
    viewed,
    locationItems: placement.locationItems,
    containerPill: placement.containerPill,
  })

  const { overlaid } = useWorkspaceInput({
    covered: props.covered,
    panel: chrome.panel,
    handleDismissPanel: chrome.handleDismissPanel,
    handleShortcuts: chrome.handleShortcuts,
    wide: frame.wide,
    overlay: layout.overlay,
    handleClosePeek: frame.handleClosePeek,
    handleToggleSidebar: frame.handleToggleSidebar,
    handleNewConversation: session.handleNewConversation,
    handleOpenAccounts,
    handleQuit,
    conversation,
    composer,
    draft,
    focused: draft.editor.current?.focused === true,
    agentView,
    agents,
    switcher,
    shells,
    services,
    settings,
    accounts,
    threads,
    agentsPicker,
    onboarding,
    whatsNew,
    footerStrip: footer.footerStrip,
    rewind,
    exitGuard,
    containerGuard,
    containerMove,
    containerResources,
    contextBrowser,
  })

  useComposerPaste({ overlaid, tokens, handleAttachImage: composer.handleAttachImage })

  const header = workspaceHeader({ welcome: layout.welcome, width: frame.width, projectDirectory: conversation.projectDirectory, repoRoot: layout.repoRoot, diff: layout.headerDiff })

  return (
    <WorkspaceView
      header={header}
      contentWidth={layout.contentWidth}
      pane={contextBrowser.viewer === null ? null : <WorkspaceContextPane control={contextBrowser} width={layout.contentWidth} />}
      transcript={
        <WorkspaceTranscript
          app={props.app}
          welcome={layout.welcome}
          wide={frame.wide}
          width={layout.contentWidth}
          modelId={selection.ref.modelId}
          thinking={settings.thinking}
          agentView={agentView}
          conversation={conversation}
          cloudHealth={session.cloudHealth}
          cloudSession={props.cloudSession}
          reconnectingSince={session.reconnectingSince}
          onRetryAttach={navigation.handleRetryAttach}
          sends={composer.sends}
          background={background}
          waitingSince={waitingSince}
          opened={session.opened}
          onToggle={session.handleToggle}
        />
      }
      chrome={
        <WorkspaceChrome
          width={layout.chromeWidth}
          composerWidth={layout.composerWidth}
          height={frame.height}
          welcome={layout.welcome}
          focused={!overlaid}
          draft={draft}
          conversation={conversation}
          agentView={agentView}
          composer={composer}
          panel={chrome.panel}
          agentTypes={props.app.agentTypes}
          naming={sidebarNaming}
          footer={footer}
          readout={viewed.readout}
        />
      }
      sidebar={
        layout.sidebarVisible ? (
          <WorkspaceSidebar
            app={props.app}
            width={frame.width}
            sidebarWidth={frame.sidebarWidth}
            overlay={layout.overlay}
            model={footer.sidebarModel}
            crew={agents.sidebar}
            naming={sidebarNaming}
            root={layout.projectRoot}
            repoName={layout.repoName}
            worktree={layout.sidebarWorktree}
            scopedRepo={viewed.scopedRepo}
            scopedWorktree={viewed.scopedWorktree}
            shells={shells}
            services={services}
            agentView={agentView}
            contextBrowser={contextBrowser}
            onRevokeGrant={conversation.handleRevokeGrant}
          />
        ) : null
      }
      overlays={
        <OverlayStack
          width={frame.width}
          height={frame.height}
          contentWidth={layout.contentWidth}
          cwd={props.app.config.cwd}
          active={selection.ref}
          accountMeters={accountMeters}
          {...{ switcher, shells, services, agents, settings, onboarding, whatsNew,
            accounts, threads, agentsPicker, rewind, qualityHealth }}
          rewindConfirm={conversation.rewindConfirm}
          operatorInput={conversation.operatorInput}
          {...{ exitGuard, containerGuard, containerResources }}
          compacting={conversation.compacting}
          rotating={conversation.rotating}
          containerMove={containerMove.move}
          containerMoveNow={containerMove.now}
          onDismissContainerMove={containerMove.handleDismiss}
          now={conversation.now}
        />
      }
    />
  )
}

import React from 'react'

import { HeaderBar } from '../ui/components/header-bar'
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

  const layout = useWorkspaceLayout({
    frame,
    conversation,
    addressing: agentView.addressing,
  })
  const sidebarNaming = useWorkspaceNaming({ conversation })

  const navigation = useWorkspaceNavigation({ props, conversation, draft, containerMove })
  const { threads, rewind } = navigation

  const { whatsNew } = props
  const { accounts, accountMeters, handleOpenAccounts, onboarding } =
    useWorkspaceAccounts({
      app: props.app,
      credentialNotice: props.credentialNotice,
      usageWarn: settings.usageWarn,
      onChooseModel: relay.handleChoose,
    })

  const { containerGuard, handleContainer } = useWorkspaceLocation({
    props,
    conversation,
    execution: placement.execution,
    containerMove,
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
  })

  useComposerPaste({ overlaid, tokens, handleAttachImage: composer.handleAttachImage })

  const header = layout.welcome ? null : <HeaderBar
      width={frame.width}
      projectDirectory={conversation.projectDirectory}
      repoRoot={layout.repoRoot}
      diff={layout.headerDiff}
    />

  return (
    <WorkspaceView
      header={header}
      contentWidth={layout.contentWidth}
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
          switcher={switcher}
          shells={shells}
          services={services}
          agents={agents}
          settings={settings}
          onboarding={onboarding}
          whatsNew={whatsNew}
          accounts={accounts}
          threads={threads}
          agentsPicker={agentsPicker}
          rewind={rewind}
          rewindConfirm={conversation.rewindConfirm}
          exitGuard={exitGuard}
          containerGuard={containerGuard}
          compacting={conversation.compacting}
          containerMove={containerMove.move}
          containerMoveNow={containerMove.now}
          onDismissContainerMove={containerMove.handleDismiss}
          now={conversation.now}
        />
      }
    />
  )
}

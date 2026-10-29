import React from 'react'

import { WorkspaceContextPane } from './workspace-context'
import { workspaceHeader } from './workspace-header'
import { useCopyOnSelect } from '../ui/selection/use-copy-on-select'
import { useComposerPaste } from './use-composer-paste'
import { useModelChecks } from './use-model-checks'
import { useSettings } from './use-settings'
import { useWorkspaceAccounts } from './use-workspace-accounts'
import { useWorkspaceComposer } from './use-workspace-composer'
import { useWorkspaceExit } from './use-workspace-exit'
import { useWorkspaceFooter } from './use-workspace-footer'
import { useWorkspaceInput } from './use-workspace-input'
import { useWorkspaceFrame, useWorkspaceLayout } from './use-workspace-layout'
import { useModelChoiceRelay, useWorkspaceModels } from './use-workspace-models'
import { useWorkspaceActions } from './use-workspace-actions'
import { useWorkspacePanels } from './use-workspace-panels'
import { useWorkspaceNaming } from './use-workspace-naming'
import { useWorkspaceNavigation } from './use-workspace-navigation'
import { useWorkspacePlacement } from './use-workspace-placement'
import { useWorkspaceSession } from './use-workspace-session'
import { OverlayStack } from './overlay-stack'
import { bootBlocks } from './boot-block-store'
import { useInlineBoot } from './use-inline-boot'
import { WorkspaceChrome } from './workspace-chrome'
import type { WorkspaceProps } from './workspace-props'
import { WorkspaceSidebar } from './workspace-sidebar'
import { WorkspaceTranscript } from './workspace-transcript'
import { WorkspaceView } from './workspace-view'

export function Workspace(props: WorkspaceProps): React.ReactNode {
  const exit = useWorkspaceExit({ props })
  const relay = useModelChoiceRelay()

  const settings = useSettings({ app: props.app, onChooseModel: relay.handleChoose })
  useModelChecks(props.app)
  useCopyOnSelect()

  const session = useWorkspaceSession({ props, settings, exit })
  const { draft, tokens, conversation, containerMove, projectPrompt } = session

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

  const {
    shells,
    services,
    contextBrowser,
    chrome,
    agentView,
    viewed,
    agents,
    background,
    waitingSince,
    qualityHealth,
  } = useWorkspacePanels({
    props,
    conversation,
    settings,
    models,
    frame,
    handleFocusComposer: session.handleFocusComposer,
  })

  const boot = bootBlocks(props.localApp)
  const inlineBoot = useInlineBoot({ app: props.localApp, threadId: conversation.threadId })
  const layout = useWorkspaceLayout({
    frame,
    conversation,
    addressing: agentView.addressing,
    booting: inlineBoot.active,
  })
  const sidebarNaming = useWorkspaceNaming({ conversation })

  const navigation = useWorkspaceNavigation({ props, conversation, draft, tokens, containerMove })
  const { threads, rewind } = navigation

  const { whatsNew } = props
  const { accounts, accountMeters, handleOpenAccounts, onboarding } = useWorkspaceAccounts({
    app: props.app,
    credentialNotice: props.credentialNotice,
    usageWarn: settings.usageWarn,
    onChooseModel: relay.handleChoose,
  })

  const { containerResources, containerGuard, handleQuit, commands, loadedSkills } =
    useWorkspaceActions({
      props,
      conversation,
      draft,
      execution: placement.execution,
      containerMove,
      shells,
      agents,
      services,
      exit,
      settings,
      switcher,
      chrome,
      rewind,
      trackedAccount: models.trackedAccount,
      cloud: session.cloud,
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
    handleUnbornSend: session.handleUnbornSend,
  })

  const footer = useWorkspaceFooter({
    app: props.app,
    draft,
    shells,
    services,
    agents,
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
    projectPrompt,
    onboarding,
    whatsNew,
    footerStrip: footer.footerStrip,
    rewind,
    exitGuard: exit.exitGuard,
    containerGuard,
    containerMove,
    boot,
    containerResources,
    contextBrowser,
  })
  useComposerPaste({ overlaid, tokens, handleAttachImage: composer.handleAttachImage })

  return (
    <WorkspaceView
      header={workspaceHeader({
        welcome: layout.welcome,
        width: frame.width,
        projectDirectory: conversation.projectDirectory,
        repoRoot: layout.repoRoot,
        diff: layout.headerDiff,
      })}
      contentWidth={layout.contentWidth}
      pane={
        contextBrowser.viewer === null ? null : (
          <WorkspaceContextPane control={contextBrowser} width={layout.contentWidth} />
        )
      }
      transcript={
        <WorkspaceTranscript
          app={props.app}
          welcome={layout.welcome}
          inlineBoot={inlineBoot}
          bootingCloudThread={props.opened.bootCloudThreadId !== undefined}
          wide={frame.wide}
          width={layout.contentWidth}
          modelId={selection.ref.modelId}
          placementShape={settings.placementChooserShape}
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
          {...{
            switcher,
            shells,
            services,
            agents,
            settings,
            onboarding,
            whatsNew,
            accounts,
            threads,
            projectPrompt,
            rewind,
            qualityHealth,
          }}
          rewindConfirm={conversation.rewindConfirm}
          operatorInput={conversation.operatorInput}
          {...{ exitGuard: exit.exitGuard, containerGuard, containerResources }}
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

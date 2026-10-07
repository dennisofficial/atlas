import type { Account, ModelRef } from '@dltech/atlas-core'
import React from 'react'

import { Accounts } from '../ui/components/accounts'
import type { Span } from '../ui/components/spans'
import type { ProviderRow } from '../ui/accounts-model'
import { CompactingOverlay, type Compacting } from '../ui/components/compacting'
import { RotatingOverlay, type Rotating } from '../ui/components/rotating'
import { ContainerGuard } from '../ui/components/container-guard'
import { ContainerMoveOverlay } from '../ui/components/container-move'
import type { ContainerMove } from './container-move'
import { ExitGuard } from '../ui/components/exit-guard'
import { exitGuardAgentRow, exitGuardRow, exitGuardServiceRow } from '../ui/exit-guard-model'
import { Rewind } from '../ui/components/rewind'
import { RewindConfirm } from '../ui/components/rewind-confirm'
import { Services } from '../ui/components/services'
import { Settings } from '../ui/components/settings'
import { Shells } from '../ui/components/shells'
import { Switcher } from '../ui/components/switcher'
import { Threads } from '../ui/components/threads'
import { AgentsPicker } from '../ui/components/agents-picker'
import { Onboarding } from '../ui/components/onboarding'
import { OperatorInputOverlay } from '../ui/components/operator-input'
import { WhatsNew } from '../ui/components/whats-new'
import { useAppearance } from '../ui/hooks/use-appearance'
import { isServiceAlive } from '../ui/services-model'
import { isShellRunning } from '../ui/shells-model'
import { isSubagentAlive } from '../store/subagent-row'
import type { AccountsControl } from './use-accounts'
import type { AgentsControl } from './use-agents'
import type { AgentsPickerControl } from './use-agents-picker'
import type { ContainerGuardControl } from './use-container-guard'
import type { ExitGuardControl } from './use-exit-guard'
import type { OnboardingControl } from './use-onboarding'
import type { OperatorInputControl } from './use-operator-input'
import type { RewindControl } from './use-rewind'
import type { RewindConfirmControl } from './use-rewind-confirm'
import type { ServicesControl } from './use-services'
import type { QualityHealthStatusProps } from './use-workspace-quality-health'
import type { SettingsControl } from './use-settings'
import type { ShellsControl } from './use-shells'
import { type SwitcherControl } from './use-switcher'
import type { ThreadsControl } from './use-threads'
import type { WhatsNewControl } from './use-whats-new'

function DerivedOverlayStack(props: {
  width: number
  height: number
  contentWidth: number
  cwd: string
  active: ModelRef
  switcher: SwitcherControl
  shells: ShellsControl
  services: ServicesControl
  agents: AgentsControl
  agentsPicker: AgentsPickerControl
  settings: SettingsControl
  qualityHealth: QualityHealthStatusProps
  onboarding: OnboardingControl
  whatsNew: WhatsNewControl
  accounts: AccountsControl
  threads: ThreadsControl
  accountMeters: (account: Account) => readonly Span[]
  rewind: RewindControl
  rewindConfirm: RewindConfirmControl
  exitGuard: ExitGuardControl
  containerGuard: ContainerGuardControl
  compacting: Compacting | null
  rotating: Rotating | null
  containerMove: ContainerMove | null
  containerMoveNow: number
  onDismissContainerMove: () => void
  operatorInput: OperatorInputControl
  now: number
}): React.ReactNode {
  const {
    switcher,
    shells,
    agents,
    agentsPicker,
    settings,
    onboarding,
    accounts,
    threads,
    rewind,
    exitGuard,
    containerGuard,
  } = props
  useAppearance()
  const sidebarWidth = Math.min(settings.sidebarWidth, props.width)

  const { whatsNew } = props

  return (
    <>
      {whatsNew.view === null ? null : (
        <WhatsNew
          width={props.width}
          height={props.height}
          fromVersion={whatsNew.view.from}
          currentVersion={whatsNew.view.to}
          releasesUrl={whatsNew.releasesUrl}
          state={whatsNew.view.state}
          onClose={whatsNew.handleClose}
        />
      )}
      {props.compacting === null ? null : (
        <CompactingOverlay compacting={props.compacting} now={props.now} width={props.width} />
      )}
      {props.rotating === null ? null : (
        <RotatingOverlay rotating={props.rotating} now={props.now} width={props.width} />
      )}
      {props.operatorInput.state === null ? null : (
        <OperatorInputOverlay
          width={Math.min(props.contentWidth, props.width)}
          state={props.operatorInput.state}
          editor={props.operatorInput.editor}
          onChange={props.operatorInput.handleChange}
          onPaste={props.operatorInput.handlePaste}
          onSubmit={props.operatorInput.handleSubmit}
          onOpenUrl={props.operatorInput.handleOpenUrl}
        />
      )}
      {props.containerMove === null ? null : (
        <ContainerMoveOverlay
          move={props.containerMove}
          now={props.containerMoveNow}
          width={props.width}
          onDismiss={props.onDismissContainerMove}
        />
      )}
      {rewind.state === null ? null : (
        <Rewind
          width={Math.min(props.contentWidth, props.width)}
          state={rewind.state}
          overlay
          onPick={rewind.handlePick}
          onDismiss={rewind.handleDismiss}
        />
      )}
      {accounts.state === null ? null : (
        <Accounts
          width={props.width}
          state={accounts.state}
          meters={props.accountMeters}
          overlay
          onPick={accounts.handlePick}
          onChooseAction={accounts.handleChooseAction}
          onChooseLogin={accounts.handleChooseLogin}
          onDismiss={accounts.handleDismiss}
          onOpenUrl={accounts.handleOpenUrl}
        />
      )}
      {threads.state === null ? null : (
        <Threads
          width={Math.min(props.contentWidth, props.width)}
          state={threads.state}
          overlay
          onPick={threads.handlePick}
          onDismiss={threads.handleDismiss}
          onQueryChange={threads.handleQuery}
        />
      )}
      {agentsPicker.state === null ? null : (
        <AgentsPicker
          width={sidebarWidth}
          state={agentsPicker.state}
          overlay
          onPick={agentsPicker.handlePick}
          onDismiss={agentsPicker.handleDismiss}
        />
      )}
      {switcher.state === null ? null : (
        <Switcher
          width={sidebarWidth}
          rows={switcher.rows}
          state={switcher.state}
          active={props.active}
          total={switcher.total}
          query={switcher.query}
          target={switcher.target}
          overlay
          onPick={switcher.handlePick}
          onSelect={switcher.handleSelect}
          onDismiss={switcher.handleDismiss}
          onQueryChange={switcher.handleQuery}
        />
      )}
      {shells.state === null ? null : (
        <Shells
          width={Math.min(props.contentWidth, props.width)}
          shells={shells.shells}
          now={shells.now}
          selected={shells.selected}
          output={shells.output}
          scroll={shells.scroll}
          overlay
          onKill={shells.handleKill}
          onDismiss={shells.handleDismiss}
        />
      )}
      {props.services.state === null ? null : (
        <Services
          width={Math.min(props.contentWidth, props.width)}
          services={props.services.services}
          now={props.services.now}
          selected={props.services.selected}
          log={props.services.log}
          scroll={props.services.scroll}
          overlay
          onStop={props.services.handleStop}
          onDismiss={props.services.handleDismiss}
        />
      )}
      {props.rewindConfirm.state === null ? null : (
        <RewindConfirm
          width={Math.min(props.contentWidth, props.width)}
          state={props.rewindConfirm.state}
          overlay
          onConfirm={props.rewindConfirm.handleConfirm}
          onDismiss={props.rewindConfirm.handleDismiss}
        />
      )}
      {exitGuard.state === null ? null : (
        <ExitGuard
          width={Math.min(props.contentWidth, props.width)}
          running={[
            ...shells.everywhere.filter(isShellRunning).map(exitGuardRow),
            ...props.services.everywhere.filter(isServiceAlive).map(exitGuardServiceRow),
            ...agents.everywhere.filter(isSubagentAlive).map(exitGuardAgentRow),
          ]}
          state={exitGuard.state}
          overlay
          onPick={exitGuard.handlePick}
          onDismiss={exitGuard.handleDismiss}
        />
      )}
      {containerGuard.state === null || containerGuard.target === null ? null : (
        <ContainerGuard
          width={Math.min(props.contentWidth, props.width)}
          target={containerGuard.target}
          running={shells.shells.filter(isShellRunning).map(exitGuardRow)}
          state={containerGuard.state}
          overlay
          onPick={containerGuard.handlePick}
          onDismiss={containerGuard.handleDismiss}
        />
      )}
      {onboarding.state === null ? null : (
        <Onboarding
          width={props.width}
          rows={onboarding.rows}
          rowIndex={onboarding.state.rowIndex}
          onActivate={onboarding.handleActivate}
          onDismiss={onboarding.handleDismiss}
        />
      )}
      {settings.state === null ? null : (
        <Settings
          width={props.width}
          sidebarWidth={sidebarWidth}
          model={settings.view}
          state={settings.state}
          cwd={props.cwd}
          origin={settings.origin}
          appearance={settings.appearance}
          prompt={settings.prompt}
          textPrompt={settings.textPrompt}
          secretOf={settings.secretOf}
          secretOrigin={settings.secretOrigin}
          problem={settings.problem}
          cloudEmail={settings.cloudEmail}
          cloudSignedIn={settings.cloudSignedIn}
          cloudSignIn={settings.cloudSignIn}
          github={{
            connection: settings.github.connection,
            unreachable: settings.github.unreachable,
            flow: settings.github.flow,
            onActivate: settings.github.activate,
            onOpenUrl: settings.handleOpenGithubUrl,
          }}
          cloudAction={settings.cloudPage.action}
          cloudUpload={settings.cloudUpload}
          cloudDownload={settings.cloudDownload}
          onSignOut={settings.handleSignOut}
          onSignIn={settings.handleSignIn}
          onOpenSignInUrl={settings.handleOpenSignInUrl}
          onUpload={settings.handleUpload}
          onDownload={settings.handleDownload}
          onSelect={settings.handleSelect}
          onDismiss={settings.handleDismiss}
          qualityHealth={props.qualityHealth}
        />
      )}
    </>
  )
}

export const OverlayStack = React.memo(DerivedOverlayStack)

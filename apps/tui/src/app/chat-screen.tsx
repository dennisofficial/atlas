import React, { useMemo } from 'react'

import { NoticeStack } from '../ui/components/notice-stack'
import { Footer } from '../ui/components/footer'
import { HeaderBar } from '../ui/components/header-bar'
import { OperatorInputOverlay } from '../ui/components/operator-input'
import { Rewind } from '../ui/components/rewind'
import { Services } from '../ui/components/services'
import { Shells } from '../ui/components/shells'
import { Sidebar } from '../ui/components/sidebar'
import { Spans, type Span } from '../ui/components/spans'
import { Transcript } from '../ui/components/transcript'
import { createKeyRegistry, KeyRegistryContext } from '../ui/keys'
import type { Hint } from '../ui/hint-layout'
import { MIN_TRANSCRIPT_WIDTH, theme } from '../ui/theme'
import { sidebarWidth } from '../ui/sidebar-width-store'
import type { PendingRow, SidebarModel } from '../store'
import { isDrawerShellRunning } from './drawer-shells'
import { ContextViewerScreen } from './context-viewer-screen'
import type { ConnectionView } from './connection-view'
import { SlashMenu } from './slash-menu-view'
import type { CommandMenu } from './use-command-menu'
import type { ContextTreeControl } from './use-context-tree'
import type { OperatorInputControl } from './use-operator-input'
import type { RewindControl } from './use-rewind'
import type { ServicesDrawer } from './use-services-drawer'
import type { SessionComposer } from './use-session-composer'
import type { SessionTranscript } from './use-session-transcript'
import type { ShellsDrawer } from './use-shells-drawer'
import type { DiffStat } from './header-model'
import type { FooterStripControl } from './use-footer-strip'
import type { FooterContext, FooterLayout } from '../ui/footer-layout'
import { modelWithAttentionFailure, type RunAttentionControl } from './use-run-attention'
import { EPodWake, type PodWake } from './use-session-wake'
import { ComposerPane } from './composer-pane'

const notDrawn = (): void => undefined

const BACK_HINT = '   esc back'

const SERVICE_HINTS: readonly Hint[] = [
  { key: '↑↓', label: 'pick' },
  { key: 's', label: 'stop' },
  { key: 'r', label: 'restart' },
  { key: 'esc', label: 'close' },
]

const noop = (): void => undefined

const controlHints = (args: { working: boolean; wake: PodWake }): readonly Span[] => [
  ...(args.working ? [{ text: '   esc stop', fg: theme.hint }] : []),
  ...(args.wake.state === EPodWake.Asleep ? [] : [{ text: '   r wake', fg: theme.hint }]),
]

export function ChatScreen(props: {
  transcript: SessionTranscript
  composer: SessionComposer
  pending: readonly PendingRow[]
  operator: OperatorInputControl
  attention: RunAttentionControl
  connection: ConnectionView
  wake: PodWake
  width: number
  height: number
  cwd: string
  now: number
  sends: number
  working: boolean
  onReconnect: () => void
  choosingModel: boolean
  menu: CommandMenu
  rewind: RewindControl
  onMenuSelect: (index: number) => void
  sidebar: SidebarModel | null
  sidebarRoot: string
  clientVersion: string
  paneNow: number
  shellFold: { hidden: number; hiddenFailed: boolean }
  serviceFold: { hidden: number; hiddenFailed: boolean }
  shells: ShellsDrawer
  services: ServicesDrawer
  context: ContextTreeControl
  openUrl: (url: string) => void
  onSelectSubagent: (agentId: string) => void
  onOpenTeammate: (sessionId: string) => void
  onShellKill: (shellId: string) => void
  header: { repo: string; diff: DiffStat | null }
  footer: FooterLayout
  footerContext: FooterContext
  footerStrip: FooterStripControl
}): React.ReactNode {
  const { composer, transcript, attention, operator, connection, wake } = props
  const { menu, rewind, shells, services } = props
  const registry = useMemo(() => createKeyRegistry(), [])
  const hints = controlHints({ working: props.working, wake })
  const model = modelWithAttentionFailure({
    model: transcript.model,
    attention: attention.attention,
    working: props.working,
  })

  const contentWidth =
    props.sidebar === null
      ? props.width
      : Math.max(MIN_TRANSCRIPT_WIDTH, props.width - sidebarWidth())

  const sidebarShells = useMemo(() => shells.rows.filter(isDrawerShellRunning), [shells.rows])
  const selectedShell = useMemo(() => shells.selected, [shells.selected])

  return (
    <KeyRegistryContext.Provider value={registry}>
      <box flexDirection="column" flexGrow={1} width={props.width}>
        <HeaderBar
          width={props.width}
          projectDirectory={props.header.repo}
          repoRoot={props.header.repo}
          diff={props.header.diff}
        />
        <box flexDirection="row" flexGrow={1} flexShrink={1} flexBasis={0} width={props.width}>
          <box
            flexDirection="column"
            flexGrow={1}
            flexShrink={1}
            flexBasis={0}
            width={contentWidth}
          >
            <box flexShrink={0} paddingLeft={2} paddingRight={2}>
              <text>
                <Spans
                  spans={[
                    { text: transcript.name ?? transcript.sessionId, fg: theme.body },
                    { text: BACK_HINT, fg: theme.hint },
                    ...hints,
                  ]}
                />
              </text>
            </box>
            <Transcript
              model={model}
              width={contentWidth}
              now={props.now}
              cwd={props.cwd}
              turn={transcript.turn}
              sends={props.sends}
              pending={props.pending}
              onNearTop={() => void transcript.loadOlder()}
              cloudConnected={connection.cloudConnected}
              reconnecting={connection.reconnecting}
              disconnected={connection.disconnected}
              waking={connection.waking}
              stale={connection.stale}
              onReconnect={props.onReconnect}
              attention={attention.attention}
              {...(attention.handleRetry === null ? {} : { onRetry: attention.handleRetry })}
              {...(attention.handleDismiss === null
                ? {}
                : { onDismissFailure: attention.handleDismiss })}
              {...(attention.handleResume === null ? {} : { onResume: attention.handleResume })}
            />
            {operator.state === null ? null : (
              <OperatorInputOverlay
                width={contentWidth}
                state={operator.state}
                editor={operator.editor}
                onChange={operator.handleChange}
                onPaste={operator.handlePaste}
                onSubmit={operator.handleSubmit}
                onOpenUrl={noop}
              />
            )}
            {rewind.state === null ? null : (
              <Rewind
                width={contentWidth}
                state={rewind.state}
                overlay
                onPick={rewind.handlePick}
                onDismiss={rewind.handleDismiss}
              />
            )}
            {menu.state === null ? null : (
              <SlashMenu width={contentWidth} state={menu.state} onSelect={props.onMenuSelect} />
            )}
            <ComposerPane
              draft={composer.draft}
              fileMenu={composer.fileMenu}
              highlights={composer.highlights}
              width={contentWidth}
              height={props.height}
              working={props.working}
              interrupting={false}
              focused={operator.state === null && !props.choosingModel && rewind.state === null}
              onCursorMoved={composer.handleCursorMoved}
            />
            <NoticeStack width={contentWidth} />
            <Footer
              width={contentWidth}
              model={props.footer.instruments.model ?? ''}
              layout={props.footer}
              context={props.footerContext}
              strip={props.footerStrip.state}
              onActivateItem={props.footerStrip.handleActivate}
            />
          </box>
          {props.sidebar === null ? null : (
            <Sidebar
              width={sidebarWidth()}
              model={props.sidebar}
              root={props.sidebarRoot}
              worktree={null}
              version={props.clientVersion}
              shells={sidebarShells}
              shellNow={props.paneNow}
              shellFold={props.shellFold}
              services={services.rows}
              serviceNow={props.paneNow}
              serviceFold={props.serviceFold}
              context={props.context.section}
              onOpenShell={shells.handleOpen}
              onOpenService={services.handleOpen}
              onSelectSubagent={props.onSelectSubagent}
              onOpenTeammate={props.onOpenTeammate}
            />
          )}
        </box>
        {shells.open ? (
          <Shells
            width={props.width}
            shells={sidebarShells}
            now={props.paneNow}
            selected={selectedShell}
            output={shells.output}
            scroll={shells.scroll}
            overlay
            onKill={props.onShellKill}
            onDismiss={shells.handleDismiss}
          />
        ) : null}
        {services.open ? (
          <Services
            width={props.width}
            rows={services.rows}
            now={props.paneNow}
            selected={services.selected}
            log={services.log}
            notice={services.notice}
            scroll={services.scroll}
            overlay
            hints={SERVICE_HINTS}
            onStart={notDrawn}
            onRestart={services.onRestart}
            onStop={services.onStop}
            onDismiss={services.handleDismiss}
          />
        ) : null}
        {props.context.viewer === null ? null : (
          <ContextViewerScreen
            width={props.width}
            path={props.context.viewer.path}
            loading={props.context.viewer.loading}
            content={props.context.viewer.content}
            openUrl={props.openUrl}
            onDismiss={props.context.handleDismiss}
            attachScroll={props.context.attachScroll}
          />
        )}
      </box>
    </KeyRegistryContext.Provider>
  )
}

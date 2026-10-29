import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/react'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import { applyTranscriptCovered } from '../ui/covered-store'
import { EKeyGroup, EKeyLayer, useKeyBindings, useKeyRegistry } from '../ui/keys'
import { globalBindings } from './global-bindings'
import type { BootBlockStore } from './boot-block-store'
import { composerCovered, keyOwners, transcriptCovered } from './overlay-presence'
import { useWorkspaceOverlays } from './use-workspace-overlays'
import type { useAccounts } from './use-accounts'
import type { useContextBrowser } from './use-context'
import type { useAgentView } from './use-agent-view'
import type { useAgents } from './use-agents'
import type { useContainerGuard } from './use-container-guard'
import type { useContainerMove } from './use-container-move'
import type { useContainerResources } from './use-container-resources'
import type { useConversation } from './use-conversation'
import type { useExitGuard } from './use-exit-guard'
import type { useFooterStrip } from './use-footer-strip'
import type { DraftControls } from '../ui/hooks/use-draft'
import type { useOnboarding } from './use-onboarding'
import { useOverlayKeys } from './use-overlay-keys'
import type { useRewind } from './use-rewind'
import type { useServices } from './use-services'
import type { useSettings } from './use-settings'
import type { useShells } from './use-shells'
import type { useSwitcher } from './use-switcher'
import type { ProjectPromptControl } from './use-project-prompt'
import type { useThreads } from './use-threads'
import type { useWhatsNew } from './use-whats-new'
import type { useWorkspaceComposer } from './use-workspace-composer'
import type { EChromePanel } from './workspace-panels'

const HELP_KEY = '?'

export type WorkspaceInputArgs = {
  covered: boolean
  panel: EChromePanel | null
  handleDismissPanel: () => void
  handleShortcuts: () => void
  wide: boolean
  overlay: boolean
  handleClosePeek: () => void
  handleToggleSidebar: () => void
  handleNewConversation: () => void
  handleOpenAccounts: () => void
  handleQuit: () => void
  conversation: Pick<
    ReturnType<typeof useConversation>,
    'handleInterrupt' | 'rewindConfirm' | 'compacting' | 'operatorInput'
  >
  composer: Pick<
    ReturnType<typeof useWorkspaceComposer>,
    'draftIsEmpty' | 'handleSubmit' | 'handleTakeBackPending' | 'handleAttachImage' | 'menus'
  >
  draft: DraftControls
  /**
   * Whether the composer's textarea currently holds the native focus — when it does, the global
   * layer is responsible for its echo, since the textarea draws every key it sees.
   */
  focused: boolean
  agentView: Pick<ReturnType<typeof useAgentView>, 'handleCycle' | 'disarmStop'>
  agents: Pick<ReturnType<typeof useAgents>, 'count'>
  switcher: Pick<ReturnType<typeof useSwitcher>, 'state' | 'handleKey' | 'handleOpen'>
  shells: Pick<ReturnType<typeof useShells>, 'state' | 'handleKey' | 'handleOpen'>
  services: Pick<ReturnType<typeof useServices>, 'state' | 'handleKey'>
  settings: Pick<ReturnType<typeof useSettings>, 'state' | 'handleKey' | 'handleOpen'>
  accounts: Pick<ReturnType<typeof useAccounts>, 'state' | 'handleKey'>
  threads: Pick<ReturnType<typeof useThreads>, 'state' | 'handleKey'>
  projectPrompt: Pick<ProjectPromptControl, 'state' | 'handleKey'>
  onboarding: Pick<ReturnType<typeof useOnboarding>, 'state' | 'handleKey'>
  whatsNew: Pick<ReturnType<typeof useWhatsNew>, 'view' | 'handleKey'>
  footerStrip: Pick<ReturnType<typeof useFooterStrip>, 'state' | 'handleKey' | 'handleEnter'>
  rewind: Pick<ReturnType<typeof useRewind>, 'state' | 'handleKey'>
  exitGuard: Pick<ReturnType<typeof useExitGuard>, 'state' | 'handleKey'>
  containerGuard: Pick<ReturnType<typeof useContainerGuard>, 'state' | 'handleKey'>
  containerMove: Pick<ReturnType<typeof useContainerMove>, 'move' | 'handleKey'>
  boot: Pick<BootBlockStore, 'handleEscape' | 'handleCancel'>
  containerResources: Pick<ReturnType<typeof useContainerResources>, 'state' | 'handleKey'>
  contextBrowser: Pick<ReturnType<typeof useContextBrowser>, 'viewer' | 'tree' | 'handleKey'>
}

export type WorkspaceInput = {
  overlaid: boolean
  picturesCovered: boolean
}

export function useWorkspaceInput(args: WorkspaceInputArgs): WorkspaceInput {
  const {
    covered,
    panel,
    handleDismissPanel,
    handleShortcuts,
    wide,
    overlay,
    handleClosePeek,
    handleToggleSidebar,
    handleNewConversation,
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
    projectPrompt,
    onboarding,
    whatsNew,
    footerStrip,
    rewind,
    exitGuard,
    containerGuard,
    containerMove,
    boot,
    containerResources,
    contextBrowser,
  } = args

  const { menus } = composer
  const promptOpen = projectPrompt.state !== null

  const dismissMenus = useRef(menus.handleDismiss)
  dismissMenus.current = menus.handleDismiss

  useEffect(() => {
    if (promptOpen) dismissMenus.current()
  }, [promptOpen])

  useKeyBindings(
    globalBindings({
      draftIsEmpty: composer.draftIsEmpty,
      onSubmit: composer.handleSubmit,
      onShortcuts: handleShortcuts,
      onTakeBackPending: composer.handleTakeBackPending,
      onEnterFooterStrip: footerStrip.handleEnter,
      onInterrupt: () => {
        if (boot.handleEscape({ draftEmpty: composer.draftIsEmpty() })) return
        conversation.handleInterrupt()
      },
      onOpenSwitcher: () => switcher.handleOpen(),
      onNewConversation: handleNewConversation,
      onAttachImage: composer.handleAttachImage,
      onOpenShells: () => shells.handleOpen(),
      onCycleAgents: agents.count === 0 ? null : agentView.handleCycle,
      onToggleSidebar: wide ? null : handleToggleSidebar,
      onOpenSettings: settings.handleOpen,
      onOpenAccounts: handleOpenAccounts,
      onQuit: () => {
        if (boot.handleCancel()) return
        handleQuit()
      },
    }),
  )

  useKeyBindings(
    overlay
      ? [
          {
            chord: 'escape',
            hint: 'close sidebar',
            layer: EKeyLayer.Overlay,
            group: EKeyGroup.Session,
            run: handleClosePeek,
          },
        ]
      : [],
  )

  const registry = useKeyRegistry()

  const { rewindConfirm } = conversation
  const compacting = conversation.compacting !== null

  const overlays = useWorkspaceOverlays({
    overlay,
    compacting,
    rewindConfirm,
    operatorInput: conversation.operatorInput,
    whatsNew,
    projectPrompt,
    exitGuard,
    containerGuard,
    containerResources,
    rewind,
    switcher,
    shells,
    services,
    accounts,
    threads,
    onboarding,
    settings,
    contextBrowser,
    footerStrip,
    containerMove,
  })

  const owners = useMemo(() => keyOwners(overlays), [overlays])
  const veil = useMemo(
    () => ({ shown: panel !== null, dismiss: handleDismissPanel, keys: [HELP_KEY] }),
    [handleDismissPanel, panel],
  )

  const blurred = covered || composerCovered(overlays)

  const { draft, focused } = args

  const swallowComposerEditKeys = useCallback(
    (): boolean => draft.editor.current?.focused === true,
    [draft],
  )

  const handleKey = useOverlayKeys({
    veil,
    owners,
    bindings: registry.snapshot,
    ...(blurred && focused ? { swallowFocusedTextareaKeys: swallowComposerEditKeys } : {}),
  })

  const handleKeyWithMenu = useCallback(
    (key: KeyEvent) => {
      if (covered) return

      if (key.eventType !== 'release' && key.name !== 'escape') agentView.disarmStop()

      if (
        !promptOpen &&
        conversation.operatorInput.state === null &&
        contextBrowser.viewer === null &&
        menus.handleKey(key)
      ) {
        key.preventDefault()
        return
      }

      handleKey(key)
    },
    [
      agentView,
      conversation.operatorInput.state,
      covered,
      contextBrowser.viewer,
      handleKey,
      menus,
      promptOpen,
    ],
  )

  useKeyboard(handleKeyWithMenu)

  const picturesCovered = covered || transcriptCovered(overlays)

  useEffect(() => {
    applyTranscriptCovered(picturesCovered)
    return () => applyTranscriptCovered(false)
  }, [picturesCovered])

  return { overlaid: blurred, picturesCovered }
}

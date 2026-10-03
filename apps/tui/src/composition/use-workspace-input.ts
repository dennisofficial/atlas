import type { KeyEvent } from '@opentui/core'
import { useKeyboard } from '@opentui/react'
import { useCallback, useEffect, useMemo } from 'react'

import { applyTranscriptCovered } from '../ui/covered-store'
import { EKeyGroup, EKeyLayer, useKeyBindings, useKeyRegistry } from '../ui/keys'
import { globalBindings } from './global-bindings'
import {
  composerCovered,
  covering,
  keyOwners,
  transcriptCovered,
  type OverlayPresence,
} from './overlay-presence'
import type { useAccounts } from './use-accounts'
import type { useContextBrowser } from './use-context'
import type { useAgentView } from './use-agent-view'
import type { useAgents } from './use-agents'
import type { useAgentsPicker } from './use-agents-picker'
import type { useContainerGuard } from './use-container-guard'
import type { useContainerMove } from './use-container-move'
import type { useConversation } from './use-conversation'
import type { useExitGuard } from './use-exit-guard'
import type { useFooterStrip } from './use-footer-strip'
import type { useOnboarding } from './use-onboarding'
import { useOverlayKeys } from './use-overlay-keys'
import type { useRewind } from './use-rewind'
import type { useServices } from './use-services'
import type { useSettings } from './use-settings'
import type { useShells } from './use-shells'
import type { useSwitcher } from './use-switcher'
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
  conversation: Pick<ReturnType<typeof useConversation>, 'handleInterrupt' | 'rewindConfirm' | 'compacting'>
  composer: Pick<ReturnType<typeof useWorkspaceComposer>,
    'draftIsEmpty' | 'handleSubmit' | 'handleTakeBackPending' | 'handleAttachImage' | 'menus'>
  agentView: Pick<ReturnType<typeof useAgentView>, 'handleCycle' | 'disarmStop'>
  agents: Pick<ReturnType<typeof useAgents>, 'count'>
  switcher: Pick<ReturnType<typeof useSwitcher>, 'state' | 'handleKey' | 'handleOpen'>
  shells: Pick<ReturnType<typeof useShells>, 'state' | 'handleKey' | 'handleOpen'>
  services: Pick<ReturnType<typeof useServices>, 'state' | 'handleKey'>
  settings: Pick<ReturnType<typeof useSettings>, 'state' | 'handleKey' | 'handleOpen'>
  accounts: Pick<ReturnType<typeof useAccounts>, 'state' | 'handleKey'>
  threads: Pick<ReturnType<typeof useThreads>, 'state' | 'handleKey'>
  agentsPicker: Pick<ReturnType<typeof useAgentsPicker>, 'state' | 'handleKey'>
  onboarding: Pick<ReturnType<typeof useOnboarding>, 'state' | 'handleKey'>
  whatsNew: Pick<ReturnType<typeof useWhatsNew>, 'view' | 'handleKey'>
  footerStrip: Pick<ReturnType<typeof useFooterStrip>, 'state' | 'handleKey' | 'handleEnter'>
  rewind: Pick<ReturnType<typeof useRewind>, 'state' | 'handleKey'>
  exitGuard: Pick<ReturnType<typeof useExitGuard>, 'state' | 'handleKey'>
  containerGuard: Pick<ReturnType<typeof useContainerGuard>, 'state' | 'handleKey'>
  containerMove: Pick<ReturnType<typeof useContainerMove>, 'move' | 'handleKey'>
  contextBrowser: Pick<ReturnType<typeof useContextBrowser>, 'viewer' | 'handleKey'>
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
    agentsPicker,
    onboarding,
    whatsNew,
    footerStrip,
    rewind,
    exitGuard,
    containerGuard,
    containerMove,
    contextBrowser,
  } = args

  const { menus } = composer

  useKeyBindings(
    globalBindings({
      draftIsEmpty: composer.draftIsEmpty,
      onSubmit: composer.handleSubmit,
      onShortcuts: handleShortcuts,
      onTakeBackPending: composer.handleTakeBackPending,
      onEnterFooterStrip: footerStrip.handleEnter,
      onInterrupt: conversation.handleInterrupt,
      onOpenSwitcher: () => switcher.handleOpen(),
      onNewConversation: handleNewConversation,
      onAttachImage: composer.handleAttachImage,
      onOpenShells: () => shells.handleOpen(),
      onCycleAgents: agents.count === 0 ? null : agentView.handleCycle,
      onToggleSidebar: wide ? null : handleToggleSidebar,
      onOpenSettings: settings.handleOpen,
      onOpenAccounts: handleOpenAccounts,
      onQuit: handleQuit,
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
  const moving = containerMove.move !== null
  const moveFailed = containerMove.move?.failure != null

  const overlays = useMemo(
    (): readonly OverlayPresence[] => [
      covering(whatsNew.view !== null, whatsNew.handleKey),
      covering(exitGuard.state !== null, exitGuard.handleKey),
      covering(containerGuard.state !== null, containerGuard.handleKey),
      covering(rewindConfirm.state !== null, rewindConfirm.handleKey),
      covering(rewind.state !== null, rewind.handleKey),
      covering(contextBrowser.viewer !== null, contextBrowser.handleKey),
      { ...covering(switcher.state !== null, switcher.handleKey), porous: true },
      covering(shells.state !== null, shells.handleKey),
      covering(services.state !== null, services.handleKey),
      covering(accounts.state !== null, accounts.handleKey),
      { ...covering(threads.state !== null, threads.handleKey), porous: true },
      covering(agentsPicker.state !== null, agentsPicker.handleKey),
      { ...covering(onboarding.state !== null, onboarding.handleKey), porous: true },
      { ...covering(settings.state !== null, settings.handleKey), porous: true },
      { ...covering(footerStrip.state !== null, footerStrip.handleKey), coversTranscript: false },
      { open: compacting, coversComposer: true, coversTranscript: true },
      {
        open: moving,
        handleKey: moveFailed ? containerMove.handleKey : undefined,
        coversComposer: true,
        coversTranscript: true,
      },
      { open: overlay, coversComposer: true, coversTranscript: false },
    ],
    [
      accounts.handleKey,
      accounts.state,
      agentsPicker.handleKey,
      agentsPicker.state,
      compacting,
      contextBrowser.handleKey,
      contextBrowser.viewer,
      containerMove.handleKey,
      exitGuard.handleKey,
      exitGuard.state,
      footerStrip.handleKey,
      footerStrip.state,
      moveFailed,
      moving,
      onboarding.handleKey,
      onboarding.state,
      whatsNew.handleKey,
      whatsNew.view,
      overlay,
      rewind.handleKey,
      rewind.state,
      rewindConfirm.handleKey,
      rewindConfirm.state,
      services.handleKey,
      services.state,
      settings.handleKey,
      settings.state,
      shells.handleKey,
      shells.state,
      switcher.handleKey,
      switcher.state,
      threads.handleKey,
      threads.state,
    ],
  )

  const owners = useMemo(() => keyOwners(overlays), [overlays])
  const veil = useMemo(
    () => ({ shown: panel !== null, dismiss: handleDismissPanel, keys: [HELP_KEY] }),
    [handleDismissPanel, panel],
  )

  const handleKey = useOverlayKeys({ veil, owners, bindings: registry.snapshot })

  const handleKeyWithMenu = useCallback(
    (key: KeyEvent) => {
      if (covered) return

      if (key.eventType !== 'release' && key.name !== 'escape') agentView.disarmStop()

      if (contextBrowser.viewer === null && menus.handleKey(key)) {
        key.preventDefault()
        return
      }

      handleKey(key)
    },
    [agentView, covered, contextBrowser.viewer, handleKey, menus],
  )

  useKeyboard(handleKeyWithMenu)

  const overlaid = covered || composerCovered(overlays)

  const picturesCovered = covered || transcriptCovered(overlays)

  useEffect(() => {
    applyTranscriptCovered(picturesCovered)
  }, [picturesCovered])

  return { overlaid, picturesCovered }
}

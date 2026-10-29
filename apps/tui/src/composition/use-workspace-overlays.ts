import { useMemo } from 'react'

import { moveOverlayPresence } from './container-move-birth'
import { covering, type OverlayPresence } from './overlay-presence'
import type { WorkspaceInputArgs } from './use-workspace-input'

type OverlaysArgs = Pick<
  WorkspaceInputArgs,
  | 'overlay'
  | 'whatsNew'
  | 'projectPrompt'
  | 'exitGuard'
  | 'containerGuard'
  | 'containerResources'
  | 'rewind'
  | 'switcher'
  | 'shells'
  | 'services'
  | 'accounts'
  | 'threads'
  | 'onboarding'
  | 'settings'
  | 'contextBrowser'
  | 'footerStrip'
  | 'containerMove'
> & {
  compacting: boolean
  rewindConfirm: WorkspaceInputArgs['conversation']['rewindConfirm']
  operatorInput: WorkspaceInputArgs['conversation']['operatorInput']
}

export function useWorkspaceOverlays(args: OverlaysArgs): readonly OverlayPresence[] {
  const {
    overlay,
    compacting,
    rewindConfirm,
    operatorInput,
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
  } = args

  return useMemo(
    (): readonly OverlayPresence[] => [
      covering(whatsNew.view !== null, whatsNew.handleKey),
      { ...covering(operatorInput.state !== null, operatorInput.handleKey), porous: true },
      covering(projectPrompt.state !== null, projectPrompt.handleKey),
      covering(exitGuard.state !== null, exitGuard.handleKey),
      covering(containerGuard.state !== null, containerGuard.handleKey),
      covering(containerResources.state !== null, containerResources.handleKey),
      covering(rewindConfirm.state !== null, rewindConfirm.handleKey),
      covering(rewind.state !== null, rewind.handleKey),
      { ...covering(switcher.state !== null, switcher.handleKey), porous: true },
      covering(shells.state !== null, shells.handleKey),
      covering(services.state !== null, services.handleKey),
      covering(accounts.state !== null, accounts.handleKey),
      { ...covering(threads.state !== null, threads.handleKey), porous: true },
      { ...covering(onboarding.state !== null, onboarding.handleKey), porous: true },
      { ...covering(settings.state !== null, settings.handleKey), porous: true },
      {
        open: contextBrowser.viewer !== null,
        handleKey: contextBrowser.handleKey,
        coversComposer: true,
        coversTranscript: contextBrowser.viewer !== null,
      },
      { ...covering(footerStrip.state !== null, footerStrip.handleKey), coversTranscript: false },
      { open: compacting, coversComposer: true, coversTranscript: true },
      moveOverlayPresence({ move: containerMove.move, handleKey: containerMove.handleKey }),
      { open: overlay, coversComposer: true, coversTranscript: false },
    ],
    [
      accounts.handleKey,
      accounts.state,
      compacting,
      contextBrowser.handleKey,
      contextBrowser.viewer,
      containerGuard.handleKey,
      containerGuard.state,
      containerMove.handleKey,
      containerMove.move,
      containerResources.handleKey,
      containerResources.state,
      operatorInput.handleKey,
      operatorInput.state,
      exitGuard.handleKey,
      exitGuard.state,
      footerStrip.handleKey,
      footerStrip.state,
      onboarding.handleKey,
      onboarding.state,
      projectPrompt.handleKey,
      projectPrompt.state,
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
}

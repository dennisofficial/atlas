import { EPodPowerPhase } from '@dltech/atlas-core'
import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import { previewPortForUrl } from '../preview-ports'
import { type BrowserState, currentUrlOf, reloaded } from './browser-model'

export enum EPreviewWait {
  Awake = 'awake',
  Waking = 'waking',
  Asleep = 'asleep',
}

export const previewWaitOf = (phase: EPodPowerPhase | undefined): EPreviewWait => {
  if (phase === EPodPowerPhase.Asleep || phase === EPodPowerPhase.Stopping)
    return EPreviewWait.Asleep
  if (phase === EPodPowerPhase.Starting) return EPreviewWait.Waking
  return EPreviewWait.Awake
}

export const previewWaitsForPod = (wait: EPreviewWait): boolean => wait !== EPreviewWait.Awake

export const previewNeedsWake = (wait: EPreviewWait): boolean => wait === EPreviewWait.Asleep

export const previewOpensOnWake = (args: {
  previous: EPreviewWait
  current: EPreviewWait
}): boolean => previewWaitsForPod(args.previous) && args.current === EPreviewWait.Awake

export const reloadedPreviews = (args: {
  state: BrowserState
  ports: readonly PreviewPort[]
}): BrowserState => {
  const { state } = args
  const ports = [...args.ports]
  const reloadedTabs = state.tabs.map((tab) =>
    previewPortForUrl({ url: currentUrlOf(tab), ports }) === null ? tab : reloaded(tab),
  )
  if (reloadedTabs.every((tab, at) => tab === state.tabs[at])) return state
  return { ...state, tabs: reloadedTabs }
}

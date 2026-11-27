import { EPodPowerPhase } from '@dltech/atlas-core'
import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import { previewPortForUrl } from '../preview-ports'
import {
  type BrowserState,
  type BrowserTab,
  currentUrlOf,
  navigated,
  reloaded,
} from './browser-model'

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

export const previewOpensOnReady = (args: {
  seen: string | undefined
  now: string | undefined
}): boolean => args.now !== undefined && args.now !== args.seen

const previewPortOfTab = (args: {
  tab: BrowserTab
  ports: readonly PreviewPort[]
}): PreviewPort | null => previewPortForUrl({ url: currentUrlOf(args.tab), ports: [...args.ports] })

const tabOfPreviewPort = (args: {
  state: BrowserState
  url: string
  ports: readonly PreviewPort[]
}): BrowserTab | undefined => {
  const target = previewPortForUrl({ url: args.url, ports: [...args.ports] })
  if (target === null) return undefined
  return args.state.tabs.find(
    (tab) => previewPortOfTab({ tab, ports: args.ports })?.port === target.port,
  )
}

export const reloadedPreviews = (args: {
  state: BrowserState
  ports: readonly PreviewPort[]
  except?: string | undefined
}): BrowserState => {
  const { state } = args
  const skipped =
    args.except === undefined
      ? null
      : previewPortForUrl({ url: args.except, ports: [...args.ports] })
  const reloadedTabs = state.tabs.map((tab) => {
    const port = previewPortOfTab({ tab, ports: args.ports })
    if (port === null) return tab
    if (skipped !== null && port.port === skipped.port) return tab
    return reloaded(tab)
  })
  if (reloadedTabs.every((tab, at) => tab === state.tabs[at])) return state
  return { ...state, tabs: reloadedTabs }
}

export const revealedPreview = (args: {
  state: BrowserState
  url: string
  ports: readonly PreviewPort[]
}): BrowserState | null => {
  const { state } = args
  const tab = tabOfPreviewPort(args)
  if (tab === undefined) return null
  return {
    ...state,
    activeId: tab.id,
    tabs: state.tabs.map((one) => {
      if (one.id !== tab.id) return one
      const moved = navigated({ tab: one, url: args.url })
      return moved === one ? reloaded(one) : moved
    }),
  }
}

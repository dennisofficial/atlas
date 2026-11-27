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

export enum EPreviewShift {
  None = 'none',
  Slept = 'slept',
  Woke = 'woke',
}

export const previewWaitOf = (phase: EPodPowerPhase | undefined): EPreviewWait => {
  if (phase === EPodPowerPhase.Asleep || phase === EPodPowerPhase.Stopping)
    return EPreviewWait.Asleep
  if (phase === EPodPowerPhase.Starting) return EPreviewWait.Waking
  return EPreviewWait.Awake
}

export const previewNeedsWake = (wait: EPreviewWait): boolean => wait === EPreviewWait.Asleep

export const previewShiftOf = (args: {
  before: EPreviewWait | undefined
  now: EPreviewWait
}): EPreviewShift => {
  if (args.before === undefined) return EPreviewShift.None
  if (args.now === EPreviewWait.Asleep) {
    return args.before === EPreviewWait.Asleep ? EPreviewShift.None : EPreviewShift.Slept
  }
  if (args.now === EPreviewWait.Waking) return EPreviewShift.None
  if (args.before === EPreviewWait.Awake) return EPreviewShift.None
  return EPreviewShift.Woke
}

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

const shiftedTab = (args: {
  tab: BrowserTab
  ports: readonly PreviewPort[]
  shift: EPreviewShift
}): BrowserTab => {
  const { tab, shift } = args
  if (previewPortOfTab({ tab, ports: args.ports }) === null) return tab
  if (shift === EPreviewShift.Slept) {
    return tab.sleptAt === tab.load.seq ? tab : { ...tab, sleptAt: tab.load.seq }
  }
  if (tab.sleptAt === undefined) return tab
  if (tab.sleptAt !== tab.load.seq) return { ...tab, sleptAt: undefined }
  return { ...reloaded(tab), sleptAt: undefined }
}

export const previewsShifted = (args: {
  state: BrowserState
  ports: readonly PreviewPort[]
  shift: EPreviewShift
}): BrowserState => {
  const { state, shift } = args
  if (shift === EPreviewShift.None) return state
  const tabs = state.tabs.map((tab) => shiftedTab({ tab, ports: args.ports, shift }))
  if (tabs.every((tab, at) => tab === state.tabs[at])) return state
  return { ...state, tabs }
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

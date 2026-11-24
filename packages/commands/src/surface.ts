import type { CommandEntry } from './entry'

export enum ESurface {
  Web = 'web',
  Mac = 'mac',
  Mobile = 'mobile',
  Tui = 'tui',
}

export enum EHiddenBecause {
  MessageAction = 'message-action',
  PaneAction = 'pane-action',
  Panel = 'panel',
}

export type SurfaceProfile = {
  surface: ESurface
  hides: readonly { name: string; because: EHiddenBecause }[]
  picks: readonly { name: string }[]
}

const PANE_ACTIONS: readonly { name: string; because: EHiddenBecause }[] = [
  { name: 'agent', because: EHiddenBecause.PaneAction },
  { name: 'shell-kill', because: EHiddenBecause.PaneAction },
]

const WEB_HIDDEN: readonly { name: string; because: EHiddenBecause }[] = [
  { name: 'rewind', because: EHiddenBecause.MessageAction },
  { name: 'summarise', because: EHiddenBecause.MessageAction },
  { name: 'skills', because: EHiddenBecause.Panel },
  { name: 'mcp', because: EHiddenBecause.Panel },
  { name: 'shells', because: EHiddenBecause.Panel },
  ...PANE_ACTIONS,
]

export const SURFACE_PROFILES: Record<ESurface, SurfaceProfile> = {
  [ESurface.Tui]: {
    surface: ESurface.Tui,
    hides: [{ name: 'summarise', because: EHiddenBecause.MessageAction }, ...PANE_ACTIONS],
    picks: [{ name: 'rewind' }],
  },
  [ESurface.Web]: { surface: ESurface.Web, hides: WEB_HIDDEN, picks: [] },
  [ESurface.Mac]: { surface: ESurface.Mac, hides: WEB_HIDDEN, picks: [] },
  [ESurface.Mobile]: { surface: ESurface.Mobile, hides: WEB_HIDDEN, picks: [] },
}

export const catalogueForSurface = ({
  entries,
  surface,
}: {
  entries: readonly CommandEntry[]
  surface: ESurface
}): readonly CommandEntry[] => {
  const hidden = new Set(SURFACE_PROFILES[surface].hides.map((entry) => entry.name))
  return entries.filter((entry) => !hidden.has(entry.name))
}

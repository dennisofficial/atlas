import type { CommandEntry } from './entry'

export enum ESurface {
  Web = 'web',
  Mac = 'mac',
  Mobile = 'mobile',
  Tui = 'tui',
}

export enum EHiddenBecause {
  MessageAction = 'message-action',
  Panel = 'panel',
}

export type SurfaceProfile = {
  surface: ESurface
  hides: readonly { name: string; because: EHiddenBecause }[]
  picks: readonly { name: string }[]
}

const MESSAGE_ACTIONS: readonly { name: string; because: EHiddenBecause }[] = [
  { name: 'rewind', because: EHiddenBecause.MessageAction },
  { name: 'summarise', because: EHiddenBecause.MessageAction },
]

export const SURFACE_PROFILES: Record<ESurface, SurfaceProfile> = {
  [ESurface.Tui]: {
    surface: ESurface.Tui,
    hides: [{ name: 'summarise', because: EHiddenBecause.MessageAction }],
    picks: [{ name: 'rewind' }],
  },
  [ESurface.Web]: { surface: ESurface.Web, hides: MESSAGE_ACTIONS, picks: [] },
  [ESurface.Mac]: { surface: ESurface.Mac, hides: MESSAGE_ACTIONS, picks: [] },
  [ESurface.Mobile]: { surface: ESurface.Mobile, hides: MESSAGE_ACTIONS, picks: [] },
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

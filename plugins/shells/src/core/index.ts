import { shellsView } from './roster'

export * from './roster'

export const shellsCoreSlots = {
  events: [] as readonly never[],
  views: [shellsView],
  commands: [] as readonly never[],
} as const

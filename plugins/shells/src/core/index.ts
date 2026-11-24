import { shellKillCommands } from './commands'
import { shellsView } from './roster'

export * from './commands'
export * from './roster'

export const shellsCoreSlots = {
  events: [] as readonly never[],
  views: [shellsView],
  commands: shellKillCommands,
} as const

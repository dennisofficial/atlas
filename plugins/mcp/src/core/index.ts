import { mcpCommand } from './commands'
import { mcpServerChangedSchema, mcpServerRemovedSchema } from './roster-events'
import { mcpRosterView } from './roster'

export * from './commands'
export * from './roster'
export * from './roster-events'
export * from './row'
export * from './sources'
export * from './specs'

export const mcpCoreSlots = {
  events: [mcpServerChangedSchema, mcpServerRemovedSchema],
  views: [mcpRosterView],
  commands: [mcpCommand],
} as const

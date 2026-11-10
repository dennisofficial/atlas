import { mcpCommand } from './commands'
import { mcpServerChangedSchema, mcpServerRemovedSchema } from './roster-events'
import { mcpRosterView } from './roster'
import { mcpSignInResolvedSchema, mcpSignInStartedSchema } from './sign-in'

export * from './commands'
export * from './roster'
export * from './roster-events'
export * from './row'
export * from './sign-in'
export * from './sources'
export * from './specs'

export const mcpCoreSlots = {
  events: [
    mcpServerChangedSchema,
    mcpServerRemovedSchema,
    mcpSignInStartedSchema,
    mcpSignInResolvedSchema,
  ],
  views: [mcpRosterView],
  commands: [mcpCommand],
} as const

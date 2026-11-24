import { agentCommands } from './commands'
import { crewView } from './roster'

export * from './agent-types'
export * from './commands'
export * from './repo-agent-type'
export * from './roster'

export const crewCoreSlots = {
  events: [] as readonly never[],
  views: [crewView],
  commands: agentCommands,
} as const

import { crewView } from './roster'

export * from './agent-types'
export * from './repo-agent-type'
export * from './roster'

export const crewCoreSlots = {
  events: [] as readonly never[],
  views: [crewView],
  commands: [] as readonly never[],
} as const

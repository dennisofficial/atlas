import { resetPeerBudgetCommand } from './commands'

export * from './commands'

export const sessionsCoreSlots = {
  events: [] as readonly never[],
  views: [] as readonly never[],
  commands: [resetPeerBudgetCommand],
} as const

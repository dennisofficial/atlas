import { serviceCommands } from './commands'
import { serviceReadySchema } from './ready-event'
import { servicesView } from './roster'

export * from './commands'
export * from './declared'
export * from './placement'
export * from './ready-event'
export * from './roster'

export const servicesCoreSlots = {
  events: [serviceReadySchema],
  views: [servicesView],
  commands: serviceCommands,
} as const

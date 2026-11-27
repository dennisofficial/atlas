import { serviceCommands } from './commands'
import { previewsReadySchema } from './previews-event'
import { serviceReadySchema } from './ready-event'
import { servicesView } from './roster'

export * from './chain'
export * from './commands'
export * from './declared'
export * from './placement'
export * from './previews-event'
export * from './ready-event'
export * from './roster'

export const servicesCoreSlots = {
  events: [serviceReadySchema, previewsReadySchema],
  views: [servicesView],
  commands: serviceCommands,
} as const

import { operatorInputAskedSchema, operatorInputSettledSchema } from './request'

export * from './request'

export const operatorCoreSlots = {
  events: [operatorInputAskedSchema, operatorInputSettledSchema],
  views: [],
  commands: [],
} as const

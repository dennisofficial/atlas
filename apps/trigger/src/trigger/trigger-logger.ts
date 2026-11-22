import { logger as triggerLogger } from '@trigger.dev/sdk'

export type TriggerLogger = {
  log: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
}

export const triggerLog: TriggerLogger = {
  log: (message) => triggerLogger.log(message),
  warn: (message) => triggerLogger.warn(message),
  error: (message) => triggerLogger.error(message),
}

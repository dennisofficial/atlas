import {
  browserSessionLog,
  defaultIndexedDbFactory,
  memorySessionLog,
  type SessionLog,
} from '@dltech/atlas-client/stream'

import { eventSchema } from './registered-plugins'
import { queuedSessionLog, type QueuedSessionLog } from './session-cache-queue'

let cache: QueuedSessionLog | undefined

export const sessionLog = (): SessionLog => {
  if (cache !== undefined) return cache
  cache = queuedSessionLog(
    defaultIndexedDbFactory() === undefined ? memorySessionLog() : browserSessionLog(eventSchema),
  )
  return cache
}

export const clearSessionLog = async (): Promise<void> => {
  cache?.stop()
  await cache?.drain()
  cache = undefined
}

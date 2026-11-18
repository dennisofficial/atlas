import {
  browserSessionLog,
  defaultIndexedDbFactory,
  memorySessionLog,
  type SessionLog,
} from '@dltech/atlas-client/stream'

import { v2EventSchema } from './registered-plugins'
import { queuedSessionLog, type QueuedSessionLog } from './session-cache-queue'

let cache: QueuedSessionLog | undefined

export const sessionLog = (): SessionLog => {
  if (cache !== undefined) return cache
  cache = queuedSessionLog(
    defaultIndexedDbFactory() === undefined ? memorySessionLog() : browserSessionLog(v2EventSchema),
  )
  return cache
}

export const clearSessionLog = async (): Promise<void> => {
  cache?.stop()
  await cache?.drain()
  cache = undefined
}

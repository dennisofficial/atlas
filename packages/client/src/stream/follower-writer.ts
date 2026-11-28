import type { SessionLog } from './session-log'
import { createSessionLogWriter, type SessionLogWriter } from './session-log-writer'
import type { SessionWindow } from './session-window'
import type { StreamScheduler } from './stream-ports'

const SAVE_INTERVAL_MS = 1_000

export type FollowerLogWriter = Pick<SessionLogWriter, 'append' | 'drop'> & {
  saveThrottled(): void
  checkpoint(): void
}

export const createFollowerLogWriter = (args: {
  log: SessionLog
  sessionId: string
  scheduler: StreamScheduler
  windowOf: () => SessionWindow
}): FollowerLogWriter => {
  const { scheduler } = args
  const writer = createSessionLogWriter({ log: args.log, sessionId: args.sessionId })
  let lastSavedAt: number | undefined
  let saveTimer: unknown

  const save = (): void => {
    saveTimer = undefined
    lastSavedAt = scheduler.now()
    writer.save(args.windowOf())
  }

  const saveThrottled = (): void => {
    if (saveTimer !== undefined) return
    const wait = lastSavedAt === undefined ? 0 : lastSavedAt + SAVE_INTERVAL_MS - scheduler.now()
    if (wait <= 0) {
      save()
      return
    }
    saveTimer = scheduler.setTimeout(save, wait)
  }

  const checkpoint = (): void => {
    if (saveTimer !== undefined) scheduler.clearTimeout(saveTimer)
    save()
  }

  return { append: writer.append, drop: writer.drop, saveThrottled, checkpoint }
}

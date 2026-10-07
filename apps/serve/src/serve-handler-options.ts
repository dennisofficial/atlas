import { createUserSettingsApplier } from './apply-user-settings'
import type { ServeApp } from './serve-app'
import type { ServeLog } from './serve-log'
import type { SessionHandlersArgs } from './socket-session'

export const handlerOptionsOf = (args: {
  app: ServeApp
  log: ServeLog
}): Pick<SessionHandlersArgs, 'transcript' | 'selectModel' | 'sessionArchive' | 'memoryArchive' | 'applyUserSettings' | 'mentions'> => {
  const { app, log } = args
  return {
    ...(app.ledger === undefined
      ? {}
      : { transcript: { log: app.log, threads: app.threads, ledger: app.ledger } }),
    ...(app.mentionFiles === undefined ? {} : { mentions: { files: app.mentionFiles, threads: app.threads } }),
    ...(app.modelBridge === undefined ? {} : { selectModel: app.modelBridge.select }),
    ...(app.sessionArchive === undefined ? {} : { sessionArchive: app.sessionArchive }),
    ...(app.memoryArchive === undefined ? {} : { memoryArchive: app.memoryArchive }),
    ...(app.settings === undefined
      ? {}
      : { applyUserSettings: createUserSettingsApplier({ settings: app.settings, log }) }),
  }
}

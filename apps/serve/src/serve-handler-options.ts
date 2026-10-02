import type { ServeApp } from './serve-app'
import type { SessionHandlersArgs } from './socket-session'

export const handlerOptionsOf = (
  app: ServeApp,
): Pick<SessionHandlersArgs, 'transcript' | 'selectModel' | 'sessionArchive' | 'memoryArchive'> => ({
  ...(app.ledger === undefined
    ? {}
    : { transcript: { log: app.log, threads: app.threads, ledger: app.ledger } }),
  ...(app.modelBridge === undefined ? {} : { selectModel: app.modelBridge.select }),
  ...(app.sessionArchive === undefined ? {} : { sessionArchive: app.sessionArchive }),
  ...(app.memoryArchive === undefined ? {} : { memoryArchive: app.memoryArchive }),
})

import type { ServeApp } from './serve-app'
import type { ServeLog } from './serve-log'
import { threadModelPersisterOf } from './serve-thread-model-persist'
import type { SessionHandlersArgs } from './socket-session'

export const handlerOptionsOf = (args: {
  app: ServeApp
  log: ServeLog
  persist: Parameters<typeof threadModelPersisterOf>[0]
}): Pick<
  SessionHandlersArgs,
  'transcript' | 'selectModel' | 'persistModel' | 'mentions' | 'rotation'
> => {
  const { app } = args
  return {
    rotation: app.rotation,
    ...(app.ledger === undefined
      ? {}
      : {
          transcript: {
            log: app.log,
            threads: app.threads,
            ledger: app.ledger,
          },
        }),
    ...(app.mentionFiles === undefined
      ? {}
      : { mentions: { files: app.mentionFiles, threads: app.threads } }),
    ...(app.modelBridge === undefined ? {} : { selectModel: app.modelBridge.select }),
    persistModel: threadModelPersisterOf(args.persist),
  }
}

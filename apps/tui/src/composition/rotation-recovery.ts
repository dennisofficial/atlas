import type { Event, ThreadId } from '@dltech/atlas-core'
import type { AtlasApp } from './compose'

type RecoveryApp = Pick<AtlasApp, 'log' | 'runner' | 'channel'>

const turnSignalled = (app: RecoveryApp, threadId: ThreadId): boolean =>
  app.channel
    .snapshot({ threadId })
    .some((signal) => signal.type === 'step-started' || (signal.type === 'turn-working' && signal.working))

export const successorHasTurned = (events: readonly Event[]): boolean =>
  events.some((event) => event.type === 'assistant-said')

export function guardedActivation(args: {
  app: RecoveryApp
  successor: ThreadId
  turnInFlight: () => boolean
}): () => Promise<void> {
  const { app, successor, turnInFlight } = args

  return async () => {
    if (turnInFlight() || turnSignalled(app, successor)) return
    if (successorHasTurned(await app.log.read({ threadId: successor }))) return

    void app.runner.runTurn({ threadId: successor })
  }
}

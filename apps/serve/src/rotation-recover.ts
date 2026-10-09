import type { ThreadId } from '@dltech/atlas-core'
import type { RotationStatus } from '@dltech/atlas-harness'

import type { ServeApp } from './serve-app'
import { EServeEvent, type ServeLog } from './serve-log'
import type { ServeTurnDriver } from './turn-driver'

const PROMPTING = new Set(['user-said', 'context-loaded', 'rotated'])

export async function successorHasTurn(args: {
  app: Pick<ServeApp, 'log'>
  driver: Pick<ServeTurnDriver, 'running' | 'outcomePending'>
  served: ThreadId
  successor: ThreadId
}): Promise<boolean> {
  if (args.successor === args.served && (args.driver.running() || args.driver.outcomePending())) return true
  const events = await args.app.log.read({ threadId: args.successor }).catch(() => [])
  return events.some((event) => !PROMPTING.has(event.type))
}

export async function recoverRotation(args: {
  app: Pick<ServeApp, 'rotation' | 'authority' | 'log' | 'runner'>
  driver: Pick<ServeTurnDriver, 'run' | 'running' | 'outcomePending'>
  threadId: ThreadId
  log: ServeLog
}): Promise<RotationStatus | undefined> {
  const { app, driver, threadId, log } = args
  if (app.rotation === undefined) return undefined

  const activate = async (): Promise<void> => {
    const successor = await app.authority?.activeMainOf({ sessionId: threadId })
    if (successor === undefined) return
    if (await successorHasTurn({ app, driver, served: threadId, successor })) return
    if (successor === threadId) {
      if (!driver.running() && !driver.outcomePending()) driver.run({ onlyIfIdle: true })
      return
    }
    void app.runner.runTurn({ threadId: successor }).catch((failure: unknown) => {
      log({ event: EServeEvent.RotationFailed, reason: failure instanceof Error ? failure.message : String(failure) })
    })
  }

  return app.rotation.recover({ sessionId: threadId, activate }).catch((failure: unknown) => {
    log({ event: EServeEvent.RotationFailed, reason: failure instanceof Error ? failure.message : String(failure) })
    return undefined
  })
}

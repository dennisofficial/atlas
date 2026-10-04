import { EKilledBy, type ThreadId } from '@dltech/atlas-core'

import { withDeadline } from './drain-deadline'
import type { RuntimeWork } from './runtime-work'
import { runtimeHasWork } from './runtime-work'
import type { ServeApp } from './serve-app'
import { EServeEvent, type ServeLog } from './serve-log'
import type { SessionHandlers } from './socket-session'
import type { ServeTurnDriver } from './turn-driver'

export function createServeLifecycle(args: {
  app: ServeApp
  driver: ServeTurnDriver
  handlers: Pick<SessionHandlers, 'park' | 'hangUp'>
  server: { stop: (closeActiveConnections?: boolean) => Promise<void> }
  bridge: { close: () => void }
  threadId: ThreadId
  admission: { closed: boolean }
  log: ServeLog
  work: () => RuntimeWork
  haltIdle: () => void
  rearmIdle?: (() => void) | undefined
  drainDeadlineMs: number
  detach: () => void
  stopSandbox: (() => Promise<void>) | undefined
  exit: (code: number) => void
  finalizePark?: (() => Promise<void>) | undefined
}): {
  close: (args: { reason: string }) => Promise<void>
  park: () => Promise<void>
} {
  let closing: Promise<void> | undefined
  let parking = false

  const close = (reason: string): Promise<void> => {
    closing ??= (async () => {
      args.admission.closed = true
      args.haltIdle()
      args.app.intake?.suspend()
      args.log({ event: EServeEvent.ShutdownRequested, threadId: args.threadId, reason, work: args.work() })
      args.detach()
      args.driver.interrupt()
      await withDeadline({ task: args.driver.settled().catch(() => undefined), ms: args.drainDeadlineMs })
      args.bridge.close()
      args.handlers.hangUp()
      await args.server.stop(true)
      await args.app.close()
      args.log({ event: EServeEvent.Stopped, threadId: args.threadId, reason })
    })()
    return closing
  }

  const park = async (): Promise<void> => {
    if (parking || closing !== undefined) return
    parking = true
    args.admission.closed = true
    args.app.intake?.suspend()
    try {
      const work = args.work()
      if (runtimeHasWork(work)) {
        args.log({ event: EServeEvent.ParkRefused, threadId: args.threadId, reason: 'work-active', work })
        args.admission.closed = false
        args.app.intake?.resume()
        parking = false
        args.rearmIdle?.()
        return
      }
      args.haltIdle()
      args.log({ event: EServeEvent.IdleStop, threadId: args.threadId, work })
      await args.app.endProcesses?.({ killedBy: EKilledBy.IdlePark })
      if (args.stopSandbox === undefined) {
        args.log({ event: EServeEvent.ParkUnfinalized, threadId: args.threadId, reason: 'provider-stop-unavailable' })
        await close('legacy-idle-exit')
        args.exit(0)
        return
      }
      await args.finalizePark?.()
      args.log({ event: EServeEvent.ParkFinalized, threadId: args.threadId })
      args.handlers.park({ reason: 'idle' })
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await args.stopSandbox()
          await close('idle-park')
          args.exit(0)
          return
        } catch (failure) {
          args.log({
            event: EServeEvent.ParkStopFailed,
            threadId: args.threadId,
            attempt,
            admissionClosed: true,
            reason: failure instanceof Error ? failure.message : String(failure),
          })
        }
      }
    } catch (failure) {
      args.log({
        event: EServeEvent.ParkStopFailed,
        threadId: args.threadId,
        admissionClosed: true,
        reason: failure instanceof Error ? failure.message : String(failure),
      })
    }
  }

  return { close: ({ reason }) => close(reason), park }
}

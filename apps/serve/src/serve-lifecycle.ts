import { EKilledBy, type ThreadId } from '@dltech/atlas-core'

import { withDeadline } from './drain-deadline'
import type { RuntimeWork } from './runtime-work'
import { runtimeHasWork } from './runtime-work'
import type { RuntimeCheckpointBinding } from './runtime-checkpoint-binding'
import type { ServeApp } from './serve-app'
import { EServeEvent, type ServeLog } from './serve-log'
import type { SessionHandlers } from './socket-session'
import type { ServeTurnDriver } from './turn-driver'

// A finalized park whose provider stop keeps failing must not latch alive forever: after this
// many exhausted re-park cycles the serve exits, and the next wake's launcher boots a fresh one.
export const PARK_STOP_CYCLE_LIMIT = 3

export function createServeLifecycle(args: {
  app: ServeApp
  driver: ServeTurnDriver
  handlers: Pick<SessionHandlers, 'park' | 'hangUp'> &
    Partial<Pick<SessionHandlers, 'abortHistory' | 'whenSettled'>>
  server: { stop: (closeActiveConnections?: boolean) => Promise<void> }
  bridge: { close: () => void }
  threadId: ThreadId
  checkpoint: Pick<RuntimeCheckpointBinding, 'parkBegin' | 'parkReopened' | 'finalizePark'>
  log: ServeLog
  work: () => RuntimeWork
  haltIdle: () => void
  rearmIdle?: (() => void) | undefined
  drainDeadlineMs: number
  detach: () => void
  stopSandbox: () => Promise<void>
  exit: (code: number) => void
}): {
  close: (args: { reason: string }) => Promise<void>
  park: () => Promise<void>
} {
  let closing: Promise<void> | undefined
  let parking = false
  let parkAttempts = 0
  let exhaustedParkCycles = 0

  const close = (reason: string): Promise<void> => {
    closing ??= (async () => {
      args.haltIdle()
      args.app.intake?.suspend()
      args.log({
        event: EServeEvent.ShutdownRequested,
        threadId: args.threadId,
        reason,
        work: args.work(),
      })
      args.detach()
      args.driver.interrupt()
      args.handlers.abortHistory?.()
      await withDeadline({
        task: Promise.all([
          args.driver.settled().catch(() => undefined),
          args.handlers.whenSettled?.().catch(() => undefined),
        ]).then(() => undefined),
        ms: args.drainDeadlineMs,
      })
      args.bridge.close()
      args.handlers.hangUp()
      await args.server.stop(true)
      await args.app.close()
      args.log({ event: EServeEvent.Stopped, threadId: args.threadId, reason })
    })()
    return closing
  }

  const reopenAdmission = async (): Promise<void> => {
    await args.checkpoint.parkReopened().catch((failure: unknown) => {
      args.log({
        event: EServeEvent.CheckpointPersistFailed,
        threadId: args.threadId,
        reason: failure instanceof Error ? failure.message : String(failure),
      })
    })
    args.app.intake?.resume()
    parking = false
    args.rearmIdle?.()
  }

  const park = async (): Promise<void> => {
    if (parking || closing !== undefined) return
    parking = true
    parkAttempts += 1
    let finalized = false
    try {
      await args.checkpoint.parkBegin({ attempts: parkAttempts })
      args.app.intake?.suspend()
      const work = args.work()
      if (runtimeHasWork(work)) {
        args.log({
          event: EServeEvent.ParkRefused,
          threadId: args.threadId,
          reason: 'work-active',
          work,
        })
        await reopenAdmission()
        return
      }
      args.haltIdle()
      args.log({ event: EServeEvent.IdleStop, threadId: args.threadId, work })
      await args.app.endProcesses?.({ killedBy: EKilledBy.IdlePark })
      const parked = await args.app.log
        .append({
          threadId: args.threadId,
          runId: args.app.ids.nextRunId(),
          drafts: [
            {
              type: 'parked',
              reason: 'idle',
              turnRunning: work.turnRunning,
              childrenRunning: work.childrenRunning,
              shellsRunning: work.shellsRunning,
              servicesRunning: work.servicesRunning,
              clientsAttached: work.clientsAttached,
            },
          ],
        })
        .catch(() => undefined)
      // app.log is the raw EventLogPort (no withEventsAppendedPublishing wrapper — that wrapper
      // exists only on the operator-input and shell registrations), so the append emits nothing.
      // The parked marker is the transcript tail the dim rule checks, so publish it explicitly.
      if (parked !== undefined)
        args.app.channel.publisherFor({ threadId: args.threadId }).eventsAppended()
      await args.checkpoint.finalizePark()
      finalized = true
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
      exhaustedParkCycles += 1
      if (exhaustedParkCycles >= PARK_STOP_CYCLE_LIMIT) {
        args.log({
          event: EServeEvent.ParkStopFailed,
          threadId: args.threadId,
          admissionClosed: true,
          reason: `provider stop failed across ${exhaustedParkCycles} re-park cycles after the park finalized; exiting so the next wake boots a fresh serve`,
        })
        await close('park-stop-unrecoverable')
        args.exit(1)
        return
      }
      parking = false
      args.rearmIdle?.()
      args.log({
        event: EServeEvent.ParkStopFailed,
        threadId: args.threadId,
        admissionClosed: true,
        reason:
          'provider stop failed 3 times after the park finalized; the idle timer is re-armed to retry',
      })
    } catch (failure) {
      args.log({
        event: EServeEvent.ParkStopFailed,
        threadId: args.threadId,
        admissionClosed: finalized,
        reason: failure instanceof Error ? failure.message : String(failure),
      })
      // Before finalization nothing has claimed this runtime is parked: the sandbox is still
      // alive and serving, so admission reopens and the idle timer re-arms. After finalization
      // the park is on record and admission stays shut on purpose — the runtime said it parked.
      if (!finalized) await reopenAdmission()
    }
  }

  return { close: ({ reason }) => close(reason), park }
}

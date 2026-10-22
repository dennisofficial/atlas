import type { ThreadId } from '@dltech/atlas-core'
import { ETurnStatus } from '@dltech/atlas-harness'
import { isApiProvisioned } from '@dltech/atlas-wire'

import type { ServeApp } from './serve-app'
import { EServeEvent, type ServeLog } from './serve-log'
import type { ServeTurnDriver } from './turn-driver'

type BootDriver = Pick<ServeTurnDriver, 'run' | 'busy' | 'settled' | 'outcome' | 'failure'>

export function resumeWhenApiProvisioned(args: {
  env: Record<string, string | undefined>
  resumable: boolean
  admissionLatched: boolean
  driver: BootDriver
  app: Pick<ServeApp, 'log' | 'channel' | 'ids'>
  threadId: ThreadId
  log: ServeLog
}): void {
  if (!isApiProvisioned(args.env) || !args.resumable) return
  if (args.admissionLatched || args.driver.busy()) return
  try {
    args.driver.run({ resume: true, onlyIfIdle: true })
  } catch (failure) {
    args.log({
      event: EServeEvent.ResumeRefused,
      reason: failure instanceof Error ? failure.message : String(failure),
    })
    return
  }
  void recordFailedBootResume(args)
}

const recordFailedBootResume = async (args: {
  driver: BootDriver
  app: Pick<ServeApp, 'log' | 'channel' | 'ids'>
  threadId: ThreadId
  log: ServeLog
}): Promise<void> => {
  await args.driver.settled()
  const outcome = args.driver.outcome()
  const crashed = args.driver.failure()
  const message = outcome?.status === ETurnStatus.Failed ? outcome.message : crashed?.message
  if (message === undefined) return
  try {
    await args.app.log.append({
      threadId: args.threadId,
      runId: args.app.ids.nextRunId(),
      drafts: [{ type: 'assistant-said', parts: [{ type: 'text', text: message }] }],
    })
    args.app.channel.publisherFor({ threadId: args.threadId }).eventsAppended()
  } catch (failure) {
    args.log({
      event: EServeEvent.TurnFailed,
      reason: `recording the failed boot resume as an event failed: ${
        failure instanceof Error ? failure.message : String(failure)
      }`,
    })
  }
}

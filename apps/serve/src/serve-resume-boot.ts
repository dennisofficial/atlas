import { isApiProvisioned } from '@dltech/atlas-wire'

import { EServeEvent, type ServeLog } from './serve-log'
import type { ServeTurnDriver } from './turn-driver'

export function resumeWhenApiProvisioned(args: {
  env: Record<string, string | undefined>
  resumable: boolean
  admissionLatched: boolean
  driver: Pick<ServeTurnDriver, 'run' | 'busy'>
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
  }
}

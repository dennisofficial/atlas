import { constants, openSync } from 'node:fs'
import { join } from 'node:path'

import { signalGroup } from './child'
import {
  EExitCause,
  EOverflowEvidence,
  exitCodeOf,
  SPOOL_FILE,
  type ExitRecord,
} from './protocol'

const GROUP_DRAIN_STEP_MS = 50
const GROUP_DRAIN_ATTEMPTS = 6

export async function groupDrained({ pgid }: { pgid: number }): Promise<void> {
  for (let attempt = 0; attempt < GROUP_DRAIN_ATTEMPTS; attempt += 1) {
    if (!signalGroup({ pgid, signal: 0 })) return
    await new Promise((resolve) => setTimeout(resolve, GROUP_DRAIN_STEP_MS))
  }
}

export function openSpool({ shellDir }: { shellDir: string }): number {
  const flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
  return openSync(join(shellDir, SPOOL_FILE), flags, 0o600)
}

export function exitRecordOf(args: {
  code: number | null
  signal: NodeJS.Signals | null
  requested: EExitCause | undefined
  spoolBytes: number
  limitBytes: number
}): ExitRecord {
  const evidence: EOverflowEvidence[] = []
  if (args.spoolBytes >= args.limitBytes) evidence.push(EOverflowEvidence.SpoolAtLimit)
  const sigxfsz = args.signal === 'SIGXFSZ'
  if (sigxfsz) evidence.push(EOverflowEvidence.LeaderKilledBySigxfsz)
  const cause = args.requested ?? (sigxfsz ? EExitCause.OutputLimit : EExitCause.Natural)

  return {
    code: args.code,
    signal: args.signal,
    exitCode: exitCodeOf({ code: args.code, signal: args.signal }),
    cause,
    endedAt: Date.now(),
    spoolBytes: args.spoolBytes,
    limitBytes: args.limitBytes,
    overflowEvidence: evidence,
  }
}

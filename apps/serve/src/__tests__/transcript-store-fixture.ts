import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ClockPort, EventId, IdPort, RunId, ThreadId } from '@dltech/atlas-core'
import { toRunId, toThreadId } from '@dltech/atlas-core'

import { JsonlEventLog, SessionRegistry } from '@dltech/atlas-harness'

export type TranscriptStore = {
  home: string
  log: JsonlEventLog
  appendSaid: (args: { threadId: ThreadId; text: string }) => Promise<void>
}

export const scratchTranscriptStore = (args: {
  prefix: string
  home?: string
}): TranscriptStore => {
  const home = args.home ?? mkdtempSync(join(tmpdir(), 'atlas-transcript-store-'))
  const clock: ClockPort = { now: () => new Date().toISOString() }
  let runs = 0
  let events = 0
  const ids: IdPort = {
    nextThreadId: (): ThreadId => toThreadId(`${args.prefix}-thread`),
    nextRunId: (): RunId => {
      runs += 1
      return toRunId(`${args.prefix}-run-${runs}`)
    },
    nextEventId: (): EventId => {
      events += 1
      return `${args.prefix}-event-${events}` as EventId
    },
    nextCallId: () => `${args.prefix}-call-1` as ReturnType<IdPort['nextCallId']>,
  }
  const registry = new SessionRegistry(home)
  const log = new JsonlEventLog(home, registry, clock, ids)
  return {
    home,
    log,
    appendSaid: async ({ threadId, text }) => {
      await log.append({
        threadId,
        runId: ids.nextRunId(),
        drafts: [{ type: 'user-said', text }],
      })
    },
  }
}

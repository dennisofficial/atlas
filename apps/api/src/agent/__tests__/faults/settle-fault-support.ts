import type { ScriptedModelStep } from '@dltech/atlas-agent/testing'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'

import type { FaultRig, HostProcess, ReadEvent } from '../../testing/fault-rig'

export const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

export const answers = (rows: readonly ReadEvent[]): number =>
  rows.filter((row) => row.type === 'assistant-said').length

export const echoScript = (args: { replies: number }): ScriptedModelStep[] =>
  Array.from({ length: args.replies }, (_, index) => ({ text: `answer ${index + 1}` }))

export const postMessage = async (args: {
  rig: FaultRig
  sessionId: string
  text: string
}): Promise<void> => {
  await args.rig.plane.post({
    sessionId: args.sessionId,
    kind: INBOX_KIND_MESSAGE,
    payload: JSON.stringify({ text: args.text }),
  })
}

export const waitAnswers = async (args: {
  rig: FaultRig
  threadId: string
  count: number
  host: HostProcess
  timeoutMs: number
}): Promise<ReadEvent[]> =>
  args.rig
    .waitForSeq({
      threadId: args.threadId,
      want: (rows) => answers(rows) >= args.count,
      timeoutMs: args.timeoutMs,
    })
    .catch((error: unknown) => {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${args.host.label} logs:\n${args.host.logs().join('\n')}`,
      )
    })

export const wakeCalls = (host: HostProcess): number => {
  const lines = host.logs()
  const started = lines.findIndex((line) => line.includes('"started hostId='))
  return lines.slice(started + 1).filter((line) => line.includes('fault: plane.wake called')).length
}

export const IDLE_KNOBS = { idleMs: 2_000, sweepMs: 1_000 } as const

export const holderOf = async (args: {
  rig: FaultRig
  sessionId: string
}): Promise<number | null> =>
  (await args.rig.plane.currentLease({ sessionId: args.sessionId })).lease.holderHostId

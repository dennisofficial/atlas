import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { EClientFrame, EServeFrame, type ServeFrame } from '@dltech/atlas-harness'

import { createTurnCommands } from '../socket-commands'
import type { SessionSocket } from '../socket-session'
import type { ServeTurnDriver } from '../turn-driver'

const socket = {} as SessionSocket

const rig = (dismiss: ServeTurnDriver['dismissFailure']) => {
  const sent: ServeFrame[] = []
  const command = createTurnCommands({
    threadId: toThreadId('t'),
    driver: { dismissFailure: dismiss } as unknown as ServeTurnDriver,
    buffer: { nextSeq: () => 1 },
    log: () => undefined,
    send: ({ frame }) => void sent.push(frame),
  })
  return { sent, command }
}

describe('dismiss-failure frame', () => {
  it('asks the driver to append the dismissal for that failure seq', () => {
    const asked: number[] = []
    const { command, sent } = rig(async ({ failureSeq }) => void asked.push(failureSeq))
    command({ socket, frame: { kind: EClientFrame.DismissFailure, failureSeq: 9 } })
    expect(asked).toEqual([9])
    expect(sent).toEqual([])
  })

  it('answers an error frame when the append fails', async () => {
    const { command, sent } = rig(async () => {
      throw new Error('log down')
    })
    command({ socket, frame: { kind: EClientFrame.DismissFailure, failureSeq: 1 } })
    await Promise.resolve()
    await Promise.resolve()
    expect(sent[0]?.kind).toBe(EServeFrame.Error)
  })
})

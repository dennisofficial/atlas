import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { EClientRequest, ERotationPhase, type ChannelSignal, type ChannelListener } from '@dltech/atlas-harness'
import { EWireRotationPhase } from '@dltech/atlas-wire'

import { RemoteRotation } from '../remote-rotation'

const MAIN = toThreadId('thr_main')
const NEXT = toThreadId('thr_next')

const channel = (reply: unknown) => {
  const listeners = new Set<ChannelListener>()
  const requests: { op: EClientRequest; params: unknown }[] = []
  return {
    requests,
    emit: (signal: ChannelSignal) => listeners.forEach((listener) => listener(signal)),
    port: {
      threadId: MAIN,
      request: async (given: { op: EClientRequest; params: unknown }) => {
        requests.push(given)
        return reply
      },
      subscribe: ({ listener }: { threadId: unknown; listener: ChannelListener }) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  }
}

describe('the rotation a cloud thread carries', () => {
  it('asks the sandbox to rotate and resolves committed when a signal names the successor', async () => {
    const fake = channel({ type: 'started' })
    const rotation = new RemoteRotation({ channel: fake.port })

    const pending = rotation.request({ sessionId: MAIN, predecessor: MAIN, instructions: 'focus' })
    await Promise.resolve()
    await Promise.resolve()
    fake.emit({ type: 'rotation-changed', rotation: { phase: EWireRotationPhase.Activating, successor: NEXT } })

    expect(await pending).toMatchObject({ kind: 'committed', successor: NEXT, predecessor: MAIN })
    expect(fake.requests[0]).toMatchObject({
      op: EClientRequest.Rotate,
      params: { threadId: MAIN, instructions: 'focus' },
    })
  })

  it('resolves failed when the sandbox refuses', async () => {
    const fake = channel({ type: 'refused', reason: 'a rotation is already underway' })
    const rotation = new RemoteRotation({ channel: fake.port })

    expect(await rotation.request({ sessionId: MAIN, predecessor: MAIN, instructions: '' })).toMatchObject({
      kind: 'failed',
      reason: 'a rotation is already underway',
    })
  })

  it('republishes rotation-changed signals as stages', () => {
    const fake = channel({ type: 'started' })
    const rotation = new RemoteRotation({ channel: fake.port })
    const phases: ERotationPhase[] = []
    rotation.subscribe((stage) => phases.push(stage.phase))

    fake.emit({ type: 'rotation-changed', rotation: { phase: EWireRotationPhase.Writing } })
    fake.emit({ type: 'events-appended' })

    expect(phases).toEqual([ERotationPhase.Committing])
  })
})

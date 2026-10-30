import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { EClientRequest } from '../channel-wire'
import { ERotationPhase } from '../../rotation/rotation-port'
import { type ChannelSignal } from '../../channel/signal'
import { type ChannelListener } from '../../channel/delta-channel'
import { EWireRotationPhase } from '@dltech/atlas-wire'

import { RemoteRotation } from '../remote-rotation'

const MAIN = toThreadId('thr_main')

const channel = (reply: unknown) => {
  const listeners = new Set<ChannelListener>()
  const requests: { op: EClientRequest; params: unknown }[] = []
  return {
    requests,
    emit: (signal: ChannelSignal) => {
      for (const listener of listeners) listener(signal)
    },
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
  it('asks the sandbox to rotate and resolves rotated when a signal reports done', async () => {
    const fake = channel({ type: 'started' })
    const rotation = new RemoteRotation({ channel: fake.port })

    const pending = rotation.request({ sessionId: MAIN, threadId: MAIN, instructions: 'focus' })
    await Promise.resolve()
    await Promise.resolve()
    fake.emit({
      type: 'rotation-changed',
      rotation: { phase: EWireRotationPhase.Done, watermarkSeq: 7 },
    })

    expect(await pending).toMatchObject({ kind: 'rotated', threadId: MAIN, watermarkSeq: 7 })
    expect(fake.requests[0]).toMatchObject({
      op: EClientRequest.Rotate,
      params: { threadId: MAIN, instructions: 'focus' },
    })
  })

  it('resolves failed when a signal reports the failure', async () => {
    const fake = channel({ type: 'started' })
    const rotation = new RemoteRotation({ channel: fake.port })

    const pending = rotation.request({ sessionId: MAIN, threadId: MAIN, instructions: '' })
    await Promise.resolve()
    await Promise.resolve()
    fake.emit({
      type: 'rotation-changed',
      rotation: { phase: EWireRotationPhase.Failed, reason: 'no summary' },
    })

    expect(await pending).toEqual({ kind: 'failed', reason: 'no summary' })
  })

  it('resolves refused when the sandbox refuses', async () => {
    const fake = channel({ type: 'refused', reason: 'a rotation is already underway' })
    const rotation = new RemoteRotation({ channel: fake.port })

    expect(await rotation.request({ sessionId: MAIN, threadId: MAIN, instructions: '' })).toEqual({
      kind: 'refused',
      reason: 'a rotation is already underway',
    })
  })

  it('republishes rotation-changed signals as stages', () => {
    const fake = channel({ type: 'started' })
    const rotation = new RemoteRotation({ channel: fake.port })
    const phases: ERotationPhase[] = []
    rotation.subscribe((stage) => phases.push(stage.phase))

    fake.emit({ type: 'rotation-changed', rotation: { phase: EWireRotationPhase.Compacting } })
    fake.emit({ type: 'events-appended' })

    expect(phases).toEqual([ERotationPhase.Compacting])
  })
})

import { describe, expect, it } from 'bun:test'

import {
  channelSignalSchema,
  decodeServeFrame,
  EClientRequest,
  encodeFrame,
  EServeFrame,
  EWireRotationPhase,
  rotateReplySchema,
  rotateRequestParamsSchema,
  rotationStateWireSchema,
  threadIdWireSchema,
  type ServeFrame,
} from '../index'

const successor = threadIdWireSchema.parse('thread-2')

describe('rotation wire schemas', () => {
  it('names the rotate op', () => {
    expect(String(EClientRequest.Rotate)).toBe('rotate')
  })

  it('round-trips a rotate request with and without instructions', () => {
    const withText = { threadId: threadIdWireSchema.parse('thread-1'), operationId: 'op-1', instructions: 'keep auth' }
    const bare = { threadId: threadIdWireSchema.parse('thread-1'), operationId: 'op-2' }

    expect(rotateRequestParamsSchema.parse(JSON.parse(JSON.stringify(withText)))).toEqual(withText)
    expect(rotateRequestParamsSchema.parse(JSON.parse(JSON.stringify(bare)))).toEqual(bare)
  })

  it('refuses a rotate request with an empty operation id', () => {
    const result = rotateRequestParamsSchema.safeParse({ threadId: 'thread-1', operationId: '' })

    expect(result.success).toBe(false)
  })

  it('round-trips each rotate reply variant', () => {
    const started = { type: 'started' as const }
    const refused = { type: 'refused' as const, reason: 'already rotating' }

    expect(rotateReplySchema.parse(JSON.parse(JSON.stringify(started)))).toEqual(started)
    expect(rotateReplySchema.parse(JSON.parse(JSON.stringify(refused)))).toEqual(refused)
  })

  it('refuses a refused reply without a reason', () => {
    expect(rotateReplySchema.safeParse({ type: 'refused' }).success).toBe(false)
  })

  it('accepts a failed state with a null or absent reason', () => {
    expect(rotationStateWireSchema.safeParse({ phase: EWireRotationPhase.Failed, reason: null }).success).toBe(true)
    expect(rotationStateWireSchema.safeParse({ phase: EWireRotationPhase.Preparing }).success).toBe(true)
  })

  it('refuses a phase outside the enum', () => {
    expect(rotationStateWireSchema.safeParse({ phase: 'sideways' }).success).toBe(false)
  })
})

describe('the rotation-changed signal', () => {
  it('decodes through channelSignalSchema', () => {
    const signal = {
      type: 'rotation-changed' as const,
      rotation: { phase: EWireRotationPhase.Activating, successor },
    }

    expect(channelSignalSchema.parse(JSON.parse(JSON.stringify(signal)))).toEqual(signal)
  })

  it('decodes inside a Signal serve frame', () => {
    const frame: ServeFrame = {
      kind: EServeFrame.Signal,
      seq: 7,
      signal: { type: 'rotation-changed', rotation: { phase: EWireRotationPhase.Failed, reason: 'no room' } },
    }

    expect(decodeServeFrame(encodeFrame(frame))).toEqual(frame)
  })
})

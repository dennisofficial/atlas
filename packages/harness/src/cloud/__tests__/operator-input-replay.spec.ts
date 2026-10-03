import { describe, expect, it } from 'bun:test'
import { EStepEnd } from '../../channel/signal'
import { EClientRequest, EServeFrame } from '../channel-wire'
import { LONG_REQUEST_TIMEOUT_MS, requestTimeoutFor } from '../request-timeout'
import { readied, THREAD, STEP } from './remote-channel-fixture'

const request = { requestId: 'req-1', description: 'paste the code', path: '/tmp/code' }

describe('remote operator input projection', () => {
  it('replays the pending card after remount and removes it after settlement', () => {
    const { channel, receive } = readied()
    receive({ kind: EServeFrame.Signal, seq: 1, signal: { type: 'operator-input', request } })
    const snapshot = channel.snapshot({ threadId: THREAD })
    expect(snapshot).toContainEqual({ type: 'operator-input', request })
    expect(channel.snapshot({ threadId: THREAD })).toBe(snapshot)
    const seen: unknown[] = []
    const off = channel.subscribe({ threadId: THREAD, listener: (signal) => seen.push(signal) })
    expect(seen).toContainEqual({ type: 'operator-input', request })
    receive({ kind: EServeFrame.Signal, seq: 2, signal: { type: 'operator-input', request: null } })
    expect(channel.snapshot({ threadId: THREAD })).not.toContainEqual({ type: 'operator-input', request })
    off()
    channel.close()
  })

  it('keeps the pending card when the model step closes', () => {
    const { channel, receive } = readied()
    receive({ kind: EServeFrame.Signal, seq: 1, signal: { type: 'step-started', stepId: STEP } })
    receive({ kind: EServeFrame.Signal, seq: 2, signal: { type: 'operator-input', request } })
    receive({ kind: EServeFrame.Signal, seq: 3, signal: { type: 'step-ended', stepId: STEP, end: EStepEnd.Completed, supersededBy: null } })
    expect(channel.snapshot({ threadId: THREAD })).toContainEqual({ type: 'operator-input', request })
    channel.close()
  })

  it('clears the card on explicit detach or close without interrupting the remote turn', () => {
    for (const action of ['detach', 'close'] as const) {
      const { channel, receive, live } = readied()
      receive({ kind: EServeFrame.Signal, seq: 1, signal: { type: 'operator-input', request } })
      channel[action]?.()
      expect(channel.snapshot({ threadId: THREAD })).not.toContainEqual({ type: 'operator-input', request })
      expect(live().sent.some((frame) => frame.kind === 'interrupt')).toBe(false)
    }
  })

  it('gives destination delivery longer than its 30-second timeout', () => {
    expect(requestTimeoutFor({ op: EClientRequest.ProvideOperatorInput })).toBe(LONG_REQUEST_TIMEOUT_MS)
  })
})

import { describe, expect, it, vi } from 'bun:test'
import { EPodReach, type PodCalls, type PodRouter, type SessionHolder } from '@dltech/atlas-host'
import { ELiveOpFailure } from '@dltech/atlas-protocol'

import { podOpsOf } from '../pod-ops'

const FORBIDDEN = { op: 'exec', argv: ['ls'] } as const
const ALLOWED = { op: 'terminal.read', terminalId: 't1', offset: 0 } as const

const opsOf = (kind: EPodReach = EPodReach.Local) => {
  const dispose = vi.fn()
  const events = vi.fn(() => dispose)
  const calls = { invoke: vi.fn(), events } as unknown as PodCalls
  const reach = vi.fn(async () => ({ kind }))
  const invoke = vi.fn(async () => ({
    state: 'unavailable' as const,
    reason: ELiveOpFailure.Asleep,
  }))
  const follow = vi.fn(async () => null)
  const router = { reach, invoke, follow } as unknown as PodRouter
  const holdPanel = vi.fn(() => true)
  const holder = {
    podCalls: () => calls,
    demandOf: () => ({ holdPanel }),
    podRouter: () => router,
  } as unknown as Pick<SessionHolder, 'podCalls' | 'demandOf' | 'podRouter'>
  return { ops: podOpsOf({ holder }), reach, invoke, follow, events, calls, holdPanel, dispose }
}

describe('podOpsOf', () => {
  it('refuses an op the control plane never runs against a pod', async () => {
    const { ops, invoke } = opsOf()

    expect(await ops.invoke({ sessionId: 's1', op: FORBIDDEN })).toEqual({
      state: 'unavailable',
      reason: ELiveOpFailure.Absent,
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('routes an allowed invoke through the pod router', async () => {
    const { ops, invoke } = opsOf()
    const signal = new AbortController().signal

    await ops.invoke({ sessionId: 's1', op: ALLOWED, waitForHolder: true, signal })

    expect(invoke).toHaveBeenCalledWith({
      sessionId: 's1',
      op: ALLOWED,
      waitForHolder: true,
      signal,
    })
  })

  it('follows a stream through the pod router', async () => {
    const { ops, follow } = opsOf()
    const listener = (): void => undefined

    await ops.follow({ sessionId: 's1', listener })

    expect(follow).toHaveBeenCalledWith({ sessionId: 's1', listener })
  })

  it('keeps the local event stream and the panel hold', () => {
    const { ops, events, holdPanel, dispose } = opsOf()
    const listener = (): void => undefined

    expect(ops.events({ sessionId: 's1', listener })).toBe(dispose)
    expect(events).toHaveBeenCalledWith({ sessionId: 's1', listener })
    expect(ops.hold({ sessionId: 's1', ttlMs: 5_000 })).toBe(true)
    expect(holdPanel).toHaveBeenCalledWith({ sessionId: 's1', ttlMs: 5_000 })
  })

  it('reports whether this instance serves the pod itself', async () => {
    expect(await opsOf(EPodReach.Local).ops.servesLocally({ sessionId: 's1' })).toBe(true)
    expect(await opsOf(EPodReach.Remote).ops.servesLocally({ sessionId: 's1' })).toBe(false)
    expect(await opsOf(EPodReach.Unreachable).ops.servesLocally({ sessionId: 's1' })).toBe(false)
  })
})

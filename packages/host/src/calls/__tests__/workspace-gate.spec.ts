import { describe, expect, it } from 'bun:test'

import type { PrepareResult } from '../../holder/ports'
import { WorkspaceGate } from '../workspace-gate'

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const deferred = (): { promise: Promise<PrepareResult>; resolve(result: PrepareResult): void } => {
  let resolve = (_result: PrepareResult): void => {}
  const promise = new Promise<PrepareResult>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('WorkspaceGate', () => {
  it('lets a call through while the workspace already prepared', async () => {
    const gate = new WorkspaceGate()
    gate.arm(Promise.resolve({ ok: true }))
    expect(await gate.wait()).toEqual({ state: 'prepared' })
  })

  it('holds a call until the current attempt prepares', async () => {
    const gate = new WorkspaceGate()
    const attempt = deferred()
    gate.arm(attempt.promise)

    let outcome: unknown
    const waiting = gate.wait().then((settled) => {
      outcome = settled
      return settled
    })
    await sleep(20)
    expect(outcome).toBeUndefined()
    attempt.resolve({ ok: true })
    expect(await waiting).toEqual({ state: 'prepared' })
  })

  it('fails the call with the reason the prepare failed', async () => {
    const gate = new WorkspaceGate()
    gate.arm(Promise.resolve({ ok: false, reason: 'the clone failed' }))
    expect(await gate.wait()).toEqual({
      state: 'failed',
      message: 'the workspace failed to prepare: the clone failed',
    })
  })

  it('reads the attempt a retry armed, not the one that had failed', async () => {
    const gate = new WorkspaceGate()
    gate.arm(Promise.resolve({ ok: false, reason: 'the clone failed' }))
    expect((await gate.wait()).state).toBe('failed')

    const retried = deferred()
    gate.arm(retried.promise)
    const waiting = gate.wait()
    retried.resolve({ ok: true })
    expect(await waiting).toEqual({ state: 'prepared' })
  })

  it('answers the call that was already waiting with the attempt it read', async () => {
    const gate = new WorkspaceGate()
    const attempt = deferred()
    gate.arm(attempt.promise)
    const waiting = gate.wait()
    attempt.resolve({ ok: false, reason: 'the setup script failed' })
    expect(await waiting).toMatchObject({ state: 'failed' })
  })

  it('returns as soon as the call aborts', async () => {
    const gate = new WorkspaceGate()
    gate.arm(deferred().promise)
    const controller = new AbortController()
    const waiting = gate.wait(controller.signal)
    controller.abort()
    expect(await waiting).toEqual({ state: 'aborted' })
  })

  it('reads a failed attempt as failed until a retry arms the gate', async () => {
    const gate = new WorkspaceGate()
    const attempt = deferred()
    gate.arm(attempt.promise)
    expect(gate.settled).toBe('pending')
    attempt.resolve({ ok: false, reason: 'the clone failed' })
    await sleep(0)
    expect(gate.settled).toBe('failed')
    gate.arm(Promise.resolve({ ok: true }))
    expect(gate.settled).toBe('pending')
    await sleep(0)
    expect(gate.settled).toBe('prepared')
  })

  it('answers an already aborted call as aborted', async () => {
    const gate = new WorkspaceGate()
    gate.arm(Promise.resolve({ ok: true }))
    const controller = new AbortController()
    controller.abort()
    expect(await gate.wait(controller.signal)).toEqual({ state: 'aborted' })
  })
})

import { describe, expect, it } from 'bun:test'

import { TeardownUnresolvedError, teardownUntilAbsent } from '../teardown'

const instant = async (): Promise<void> => undefined

const world = (args: { sandboxGoneAfter: number; driveGoneAfter: number }) => {
  const state = { destroys: 0, order: [] as string[] }
  return {
    state,
    destroy: async () => {
      state.destroys += 1
      state.order.push(`destroy${state.destroys}`)
    },
    sandboxPresent: async () => state.destroys < args.sandboxGoneAfter,
    drivePresent: async () => state.destroys < args.driveGoneAfter,
  }
}

describe('teardownUntilAbsent', () => {
  it('destroys at least once even when nothing is observable, then reports both halves absent', async () => {
    const held = world({ sandboxGoneAfter: 0, driveGoneAfter: 0 })

    const result = await teardownUntilAbsent({ ...held, sleep: instant })

    expect(held.state.destroys).toBe(1)
    expect(result).toEqual({ sandboxAbsent: true, driveAbsent: true, attempts: 1 })
  })

  it('retries the idempotent destroy until the drive half is gone', async () => {
    const held = world({ sandboxGoneAfter: 1, driveGoneAfter: 3 })

    const result = await teardownUntilAbsent({ ...held, sleep: instant })

    expect(result.attempts).toBe(3)
    expect(held.state.destroys).toBe(3)
  })

  it('waits for the prior teardown and still retries when it rejected', async () => {
    const held = world({ sandboxGoneAfter: 1, driveGoneAfter: 1 })
    const pending = Promise.reject(new Error('prior attempt failed'))

    const result = await teardownUntilAbsent({ ...held, pending, sleep: instant })

    expect(held.state.destroys).toBe(1)
    expect(result.attempts).toBe(1)
  })

  it('does not start a destroy while the prior one is still running', async () => {
    const held = world({ sandboxGoneAfter: 1, driveGoneAfter: 1 })
    let release: () => void = () => undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })

    const running = teardownUntilAbsent({ ...held, pending, sleep: instant })
    await Promise.resolve()
    expect(held.state.destroys).toBe(0)
    release()
    await running

    expect(held.state.destroys).toBe(1)
  })

  it('throws naming the half that never went away', async () => {
    const held = world({ sandboxGoneAfter: 1, driveGoneAfter: 99 })

    const failure = await teardownUntilAbsent({ ...held, attempts: 3, sleep: instant }).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(TeardownUnresolvedError)
    expect((failure as TeardownUnresolvedError).result).toEqual({
      sandboxAbsent: true,
      driveAbsent: false,
      attempts: 3,
    })
  })

  it('treats a probe that cannot answer as still present, never as absent', async () => {
    const held = world({ sandboxGoneAfter: 0, driveGoneAfter: 0 })

    const failure = await teardownUntilAbsent({
      ...held,
      sandboxPresent: async () => {
        throw new Error('lookup failed')
      },
      attempts: 2,
      sleep: instant,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(TeardownUnresolvedError)
    expect((failure as TeardownUnresolvedError).result.sandboxAbsent).toBe(false)
  })

  it('gives up when the whole budget is spent', async () => {
    const failure = await teardownUntilAbsent({
      destroy: () => new Promise<void>(() => undefined),
      sandboxPresent: async () => true,
      drivePresent: async () => true,
      timeoutMs: 20,
      sleep: instant,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(TeardownUnresolvedError)
  })
})

import { describe, expect, it } from 'bun:test'

import type { RevealGate } from '@dltech/atlas-client/transcript'

import { createRevealDriver } from '../reveal-driver'

function frames() {
  const queue = new Map<number, () => void>()
  let next = 0
  const gates: (RevealGate | null)[] = []
  const driver = createRevealDriver({
    requestFrame: (run) => {
      next += 1
      queue.set(next, run)
      return next
    },
    cancelFrame: (handle) => void queue.delete(handle),
    onGate: (gate) => void gates.push(gate),
  })
  const tick = () => {
    const [handle, run] = [...queue][0] ?? []
    if (handle === undefined || run === undefined) return false
    queue.delete(handle)
    run()
    return true
  }
  return { driver, gates, tick, pending: () => queue.size }
}

const drain = (tick: () => boolean) => {
  let ran = tick()
  while (ran) ran = tick()
}

const tailOf = (text: string) => ({ key: 'step_1:text:t', text })

describe('the reveal frame driver', () => {
  it('requests no frame while there is no tail', () => {
    const { driver, pending } = frames()
    driver.setTail(null)
    expect(pending()).toBe(0)
  })

  it('attaches at zero, then reveals once per frame until the tail is drained', () => {
    const { driver, gates, tick, pending } = frames()
    driver.setTail(tailOf('x'.repeat(100)))
    expect(gates.at(-1)).toEqual({ key: 'step_1:text:t', revealed: 0 })
    expect(pending()).toBe(1)

    let ticks = 0
    while (tick()) ticks += 1

    expect(gates.at(-1)?.revealed).toBe(100)
    expect(ticks).toBeGreaterThan(1)
    expect(pending()).toBe(0)
  })

  it('does not set state when a frame changes nothing', () => {
    const { driver, gates, tick } = frames()
    driver.setTail(tailOf('abc'))
    drain(tick)
    const settled = gates.length

    driver.setTail(tailOf('abc'))
    expect(tick()).toBe(false)
    expect(gates).toHaveLength(settled)
  })

  it('resumes draining when the tail grows', () => {
    const { driver, gates, tick } = frames()
    driver.setTail(tailOf('abc'))
    drain(tick)

    driver.setTail(tailOf('abcdef'))
    drain(tick)

    expect(gates.at(-1)?.revealed).toBe(6)
  })

  it('cancels the pending frame on stop', () => {
    const { driver, pending } = frames()
    driver.setTail(tailOf('abcdef'))
    driver.stop()
    expect(pending()).toBe(0)
  })
})

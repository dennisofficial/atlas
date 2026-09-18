import { describe, expect, it } from 'bun:test'

import { toStepId } from '../../channel/signal'
import { createFrameBuffer } from '../frame-buffer'

const started = (step: string) => ({ type: 'step-started', stepId: toStepId(step) }) as const

describe('createFrameBuffer', () => {
  it('numbers frames from zero and monotonically', () => {
    const buffer = createFrameBuffer({ capacity: 4 })

    expect(buffer.nextSeq()).toBe(0)
    expect(buffer.push(started('a')).seq).toBe(0)
    expect(buffer.push(started('b')).seq).toBe(1)
    expect(buffer.nextSeq()).toBe(2)
  })

  it('holds nothing before a frame has been emitted', () => {
    const buffer = createFrameBuffer({ capacity: 4 })

    expect(buffer.holds(0)).toBe(false)
    expect(buffer.holds(7)).toBe(false)
  })

  it('replays only what follows a cursor it still holds', () => {
    const buffer = createFrameBuffer({ capacity: 4 })
    for (const step of ['a', 'b', 'c']) buffer.push(started(step))

    expect(buffer.holds(0)).toBe(true)
    expect(buffer.after(0).map((frame) => frame.seq)).toEqual([1, 2])
    expect(buffer.after(2)).toEqual([])
  })

  it('refuses a cursor that fell out of the ring', () => {
    const buffer = createFrameBuffer({ capacity: 2 })
    for (const step of ['a', 'b', 'c', 'd']) buffer.push(started(step))

    expect(buffer.holds(0)).toBe(false)
    expect(buffer.holds(1)).toBe(true)
    expect(buffer.after(1).map((frame) => frame.seq)).toEqual([2, 3])
  })

  it('refuses a cursor from beyond what it has sent', () => {
    const buffer = createFrameBuffer({ capacity: 4 })
    buffer.push(started('a'))

    expect(buffer.holds(1)).toBe(false)
  })

  it('separates a frame it still holds from a cursor it will resume', () => {
    const buffer = createFrameBuffer({ capacity: 2 })
    for (const step of ['a', 'b', 'c']) buffer.push(started(step))

    expect(buffer.holds(0)).toBe(true)
    expect(buffer.contains(0)).toBe(false)
    expect(buffer.contains(1)).toBe(true)
    expect(buffer.contains(3)).toBe(false)
  })

  it('contains nothing before a frame has been emitted', () => {
    expect(createFrameBuffer({ capacity: 4 }).contains(0)).toBe(false)
  })

  it('reads the frames of a step from the seq it started at', () => {
    const buffer = createFrameBuffer({ capacity: 8 })
    buffer.push(started('a'))
    const second = buffer.push(started('b'))
    buffer.push(started('c'))

    expect(buffer.from(second.seq).map((frame) => frame.seq)).toEqual([1, 2])
  })
})

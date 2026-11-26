import { describe, expect, it } from 'bun:test'

import { InProcessWorkCounter } from '../in-process-work'

const settled = async (promise: Promise<void>): Promise<boolean> => {
  let done = false
  void promise.then(() => {
    done = true
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  return done
}

describe('in-process work', () => {
  it('is idle until a mark begins, and idle again once every mark ends', async () => {
    const work = new InProcessWorkCounter()
    expect(await settled(work.whenIdle())).toBe(true)

    const first = work.begin()
    const second = work.begin()
    const idle = work.whenIdle()
    first()
    first()
    expect(await settled(idle)).toBe(false)

    second()
    expect(await settled(idle)).toBe(true)
  })

  it('stops counting a mark whose work reached the pod', async () => {
    const work = new InProcessWorkCounter()
    work.begin()
    expect(work.running).toBe(true)

    work.releaseToPod()
    expect(work.running).toBe(false)
    expect(await settled(work.whenIdle())).toBe(true)
  })
})

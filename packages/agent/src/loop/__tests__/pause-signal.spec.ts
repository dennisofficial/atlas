import { describe, expect, it } from 'bun:test'

import { PauseSignal } from '../pause-signal'

const settled = async (promise: Promise<void>): Promise<boolean> => {
  let done = false
  void promise.then(() => {
    done = true
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  return done
}

describe('a pause signal', () => {
  it('is idle until a model step begins, and idle again once it ends', async () => {
    const pause = new PauseSignal()
    expect(await settled(pause.whenModelIdle())).toBe(true)

    const ended = pause.beginModelStep()
    expect(await settled(pause.whenModelIdle())).toBe(false)

    ended?.()
    expect(await settled(pause.whenModelIdle())).toBe(true)
  })

  it('waits for every in-flight model step, and ends a step once', async () => {
    const pause = new PauseSignal()
    const first = pause.beginModelStep()
    const second = pause.beginModelStep()
    const idle = pause.whenModelIdle()

    first?.()
    first?.()
    expect(await settled(idle)).toBe(false)

    second?.()
    expect(await settled(idle)).toBe(true)
  })

  it('refuses to admit a model step once it is paused', async () => {
    const pause = new PauseSignal()
    expect(pause.beginModelStep()).toBeDefined()
    pause.pause()
    expect(pause.beginModelStep()).toBeUndefined()
    expect(pause.modelStepRunning).toBe(true)
  })

  it('aborts the model step without telling the pause listeners, and the other way round', async () => {
    const pause = new PauseSignal()
    const aborts: string[] = []
    const pauses: string[] = []
    pause.onModelAbort(() => aborts.push('model'))
    pause.onPause(() => pauses.push('pause'))

    pause.pause()
    expect(pauses).toEqual(['pause'])
    expect(aborts).toEqual([])

    pause.abortModelStep()
    expect(aborts).toEqual(['model'])
    expect(pauses).toEqual(['pause'])
  })
})

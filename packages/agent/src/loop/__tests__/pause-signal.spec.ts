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

  it('stays settling until the step it began is released, once', async () => {
    const pause = new PauseSignal()
    expect(await settled(pause.whenStepSettled())).toBe(true)

    const release = pause.beginStepSettle()
    expect(pause.stepSettling).toBe(true)
    const stepSettled = pause.whenStepSettled()
    expect(await settled(stepSettled)).toBe(false)

    release()
    release()
    expect(await settled(stepSettled)).toBe(true)
    expect(pause.stepSettling).toBe(false)
  })

  it('waits for every in-flight step, whatever the model streams', async () => {
    const pause = new PauseSignal()
    const release = pause.beginStepSettle()
    const ended = pause.beginModelStep()
    ended?.()
    const stepSettled = pause.whenStepSettled()

    expect(await settled(stepSettled)).toBe(false)
    release()
    expect(await settled(stepSettled)).toBe(true)
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

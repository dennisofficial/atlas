import { describe, expect, it } from 'bun:test'

import { BackgroundWork } from '../../_core/ports/background-work'
import { backgroundWorkProvider, ProcessBackgroundWork } from './background-work.providers'

describe('background work providers', () => {
  it('binds the process implementation', () => {
    expect(backgroundWorkProvider()).toEqual({
      provide: BackgroundWork,
      useClass: ProcessBackgroundWork,
    })
  })

  it('keeps no work waiting for shutdown once it settles', async () => {
    const work = Promise.resolve()
    const background = new ProcessBackgroundWork()

    background.keepAlive(work)
    await work
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(background['running'].size).toBe(0)
  })

  it('waits for tracked work before the process leaves', async () => {
    let finish = (): void => undefined
    const background = new ProcessBackgroundWork()

    background.keepAlive(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    const shutdown = background.onApplicationShutdown()
    finish()

    await shutdown
    expect(background['running'].size).toBe(0)
  })
})

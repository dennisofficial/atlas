import { afterEach, describe, expect, it, mock, vi } from 'bun:test'
import { hoisted, stubEnv, unstubAllEnvs } from '@dltech/bun-test-shims'

const waitUntil = hoisted(() => vi.fn())
mock.module('@vercel/functions', () => ({ waitUntil }))

import { BackgroundWork } from '../../_core/ports/background-work'
import {
  backgroundWorkProvider,
  ProcessBackgroundWork,
  VercelBackgroundWork,
} from './background-work.providers'

describe('background work providers', () => {
  afterEach(() => {
    unstubAllEnvs()
    waitUntil.mockReset()
  })

  it('binds the Vercel implementation when VERCEL=1', () => {
    stubEnv('VERCEL', '1')

    expect(backgroundWorkProvider()).toEqual({
      provide: BackgroundWork,
      useClass: VercelBackgroundWork,
    })
  })

  it('binds the process implementation elsewhere', () => {
    stubEnv('VERCEL', '')

    expect(backgroundWorkProvider()).toEqual({
      provide: BackgroundWork,
      useClass: ProcessBackgroundWork,
    })
  })

  it('hands the promise to waitUntil on Vercel', () => {
    const work = Promise.resolve()

    new VercelBackgroundWork().keepAlive(work)

    expect(waitUntil).toHaveBeenCalledWith(work)
  })

  it('keeps no work waiting for shutdown once it settles', async () => {
    const work = Promise.resolve()
    const background = new ProcessBackgroundWork()

    background.keepAlive(work)
    await work
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(waitUntil).not.toHaveBeenCalled()
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

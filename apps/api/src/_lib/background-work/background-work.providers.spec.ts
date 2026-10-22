import { afterEach, describe, expect, it, vi } from 'vitest'

const waitUntil = vi.hoisted(() => vi.fn())
vi.mock('@vercel/functions', () => ({ waitUntil }))

import { BackgroundWork } from '../../_core/ports/background-work'
import {
  backgroundWorkProvider,
  ProcessBackgroundWork,
  VercelBackgroundWork,
} from './background-work.providers'

describe('background work providers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    waitUntil.mockReset()
  })

  it('binds the Vercel implementation when VERCEL=1', () => {
    vi.stubEnv('VERCEL', '1')

    expect(backgroundWorkProvider()).toEqual({
      provide: BackgroundWork,
      useClass: VercelBackgroundWork,
    })
  })

  it('binds the process implementation elsewhere', () => {
    vi.stubEnv('VERCEL', '')

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

  it('does nothing in the process implementation', () => {
    new ProcessBackgroundWork().keepAlive()

    expect(waitUntil).not.toHaveBeenCalled()
  })
})

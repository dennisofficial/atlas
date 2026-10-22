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

    expect(backgroundWorkProvider()).toEqual({ provide: BackgroundWork, useClass: VercelBackgroundWork })
  })

  it('binds the process implementation elsewhere', () => {
    stubEnv('VERCEL', '')

    expect(backgroundWorkProvider()).toEqual({ provide: BackgroundWork, useClass: ProcessBackgroundWork })
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

import { describe, expect, it, spyOn } from 'bun:test'
import { toRunId, toThreadId } from '@dltech/atlas-core'
import { ETurnStatus, type TurnOutcome } from '@dltech/atlas-harness'

import { createTurnDriver } from '../turn-driver'
import type { ServeFamily } from '../serve-app'
import { fakeServeApp } from './fakes'

const threadId = toThreadId('failed-relocation-unwind')
const gate = <T>() => {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

const fixture = (args: { family: ServeFamily; runTurn?: () => Promise<TurnOutcome> }) => {
  const app = fakeServeApp({
    threadId,
    root: '/workspace',
    intake: true,
    family: args.family,
    ...(args.runTurn === undefined ? {} : { runTurn: args.runTurn }),
  })
  const failures: string[] = []
  const driver = createTurnDriver({
    app,
    threadId,
    onTurnStarted: () => undefined,
    onTurnEnded: () => undefined,
    onOutcome: () => undefined,
    onFailure: (reason) => {
      failures.push(reason)
    },
  })
  const register = spyOn(app.intake!, 'register')
  driver.attach(app.intake!)
  const blocked = (): boolean => register.mock.calls[0]![0].driver.blocked()
  return { app, driver, failures, blocked }
}

const assertUnwound = async (test: ReturnType<typeof fixture>): Promise<void> => {
  await Bun.sleep(1)
  expect(test.blocked()).toBe(false)
  await expect(test.driver.say({ text: 'input after the failed handoff' })).resolves.toBeUndefined()
}

describe('failed relocation unwind', () => {
  it('unfreezes the driver and resumes children when the family pause rejects', async () => {
    let resumes = 0
    const test = fixture({
      family: {
        pauseChildren: async () => {
          throw new Error('family persistence failed')
        },
        resumeChildren: async () => {
          resumes += 1
        },
      },
    })
    await expect(test.driver.beginRelocation()).rejects.toThrow('family persistence failed')
    expect(test.failures).toEqual(['family persistence failed'])
    expect(resumes).toBe(1)
    await assertUnwound(test)
    test.app.intake?.dispose()
  })

  it('unwinds when the running parent turn ends in failure instead of pausing', async () => {
    const parent = gate<TurnOutcome>()
    let resumes = 0
    const test = fixture({
      runTurn: () => parent.promise,
      family: {
        pauseChildren: async () => undefined,
        resumeChildren: async () => {
          resumes += 1
        },
      },
    })
    test.driver.run()
    const preparation = test.driver.beginRelocation()
    parent.resolve({
      status: ETurnStatus.Failed,
      runId: toRunId('failed-run'),
      message: 'tool append failed',
      cause: null,
    })
    await expect(preparation).rejects.toThrow('tool append failed')
    expect(test.failures).toEqual(['tool append failed'])
    expect(resumes).toBe(1)
    await assertUnwound(test)
    test.app.intake?.dispose()
  })

  it('reports a child that cannot resume without leaving the driver frozen', async () => {
    const test = fixture({
      family: {
        pauseChildren: async () => {
          throw new Error('family persistence failed')
        },
        resumeChildren: async () => {
          throw new Error('child would not resume')
        },
      },
    })
    await expect(test.driver.beginRelocation()).rejects.toThrow('family persistence failed')
    await Bun.sleep(1)
    expect(test.failures).toEqual(['family persistence failed', 'child would not resume'])
    await assertUnwound(test)
    test.app.intake?.dispose()
  })

  it('accepts a fresh relocation after a failed one', async () => {
    let attempts = 0
    const test = fixture({
      family: {
        pauseChildren: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('family persistence failed')
        },
        resumeChildren: async () => undefined,
      },
    })
    await expect(test.driver.beginRelocation()).rejects.toThrow('family persistence failed')
    await Bun.sleep(1)
    await test.driver.beginRelocation()
    expect(attempts).toBe(2)
    await expect(test.driver.say({ text: 'paused again' })).rejects.toThrow('paused')
    test.app.intake?.dispose()
  })
})

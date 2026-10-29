import { describe, expect, it } from 'bun:test'
import { toRunId, toThreadId } from '@dltech/atlas-core'
import { ETurnStatus, type TurnOutcome } from '@dltech/atlas-harness'

import { createTurnDriver } from '../turn-driver'
import { fakeServeApp } from './fakes'

const threadId = toThreadId('before-turn')
const completed: TurnOutcome = { status: ETurnStatus.Completed, runId: toRunId('before-turn-run') }

const fixture = (beforeTurn: () => Promise<void>) => {
  const order: string[] = []
  const app = fakeServeApp({
    threadId,
    root: '/workspace',
    runTurn: async () => {
      order.push('runTurn')
      return completed
    },
  })
  const driver = createTurnDriver({
    app,
    threadId,
    beforeTurn: async () => {
      order.push('beforeTurn')
      await beforeTurn()
    },
    onTurnStarted: () => undefined,
    onTurnEnded: () => undefined,
    onOutcome: () => undefined,
    onFailure: () => undefined,
  })
  return { app, driver, order }
}

describe('turn driver beforeTurn step', () => {
  it('runs before the turn starts', async () => {
    const { driver, order } = fixture(async () => undefined)
    driver.run()
    await driver.settled()
    expect(order).toEqual(['beforeTurn', 'runTurn'])
  })

  it('is skipped when the turn resumes', async () => {
    const { app, driver, order } = fixture(async () => undefined)
    app.runner.resume = async () => {
      order.push('resume')
      return completed
    }
    driver.run({ resume: true })
    await driver.settled()
    expect(order).toEqual(['resume'])
  })

  it('lets the turn proceed when the refresh fails', async () => {
    const { driver, order } = fixture(async () => {
      throw new Error('cloud unreachable')
    })
    driver.run()
    await driver.settled()
    expect(order).toEqual(['beforeTurn', 'runTurn'])
    expect(driver.failure()).toBeNull()
  })
})

import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'
import { ETurnStatus } from '@dltech/atlas-harness'

import { createTurnDriver } from '../turn-driver'
import type { ServeApp } from '../serve-app'
import { fakeServeApp } from './fakes'

describe('an idle session relocation', () => {
  it('acknowledges only after its active children have paused', async () => {
    const app: ServeApp = fakeServeApp({ threadId: toThreadId('brn_idle_relocation'), root: '/workspace' })
    const order: string[] = []
    let release: () => void = () => undefined
    const paused = new Promise<void>((resolve) => { release = resolve })
    app.family = { pauseChildren: async () => { order.push('pause children'); await paused } }
    const driver = createTurnDriver({
      app,
      threadId: toThreadId('brn_idle_relocation'),
      onTurnStarted: () => { order.push('turn') },
      onTurnEnded: () => undefined,
      onFailure: (reason) => { throw new Error(reason) },
      onOutcome: (outcome) => { order.push(outcome.status) },
    })

    driver.beginRelocation()
    await Promise.resolve()
    expect(order).toEqual(['pause children'])
    release()
    await driver.settled()
    expect(order).toEqual(['pause children', ETurnStatus.RelocationPaused])
  })
})

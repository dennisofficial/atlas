import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import type { RuntimeWork } from '../runtime-work'
import { createServeLifecycle } from '../serve-lifecycle'
import { EServeEvent } from '../serve-log'
import { createTurnDriver } from '../turn-driver'
import { fakeServeApp } from './fakes'

const threadId = toThreadId('lifecycle-flush')

const quiet = (): RuntimeWork => ({
  turnRunning: false,
  busy: false,
  childrenRunning: 0,
  shellsRunning: 0,
  servicesRunning: 0,
  pendingInput: false,
  settlingWork: false,
  clientsAttached: 0,
})

const parkWith = async (flushEvents: () => Promise<boolean>) => {
  const app = fakeServeApp({ threadId, root: '/workspace', intake: true })
  const driver = createTurnDriver({
    app,
    threadId,
    onTurnStarted: () => undefined,
    onTurnEnded: () => undefined,
    onOutcome: () => undefined,
    onFailure: () => undefined,
  })
  const calls: string[] = []
  const lifecycle = createServeLifecycle({
    app,
    driver,
    threadId,
    checkpoint: {
      parkBegin: async () => void calls.push('park-begin'),
      parkReopened: async () => void calls.push('park-reopened'),
      finalizePark: async () => void calls.push('finalize'),
    },
    handlers: { park: () => void calls.push('parked'), hangUp: () => undefined },
    server: { stop: async () => undefined },
    bridge: { close: () => undefined },
    log: ({ event, reason }) =>
      void calls.push(reason === undefined ? event : `${event}:${reason}`),
    work: quiet,
    haltIdle: () => undefined,
    rearmIdle: () => void calls.push('rearm-idle'),
    drainDeadlineMs: 100,
    detach: () => undefined,
    stopSandbox: async () => void calls.push('provider-stop'),
    flushEvents: async () => {
      calls.push('flush')
      return flushEvents()
    },
    exit: () => void calls.push('exit'),
  })
  await lifecycle.park()
  return calls
}

describe('park flushes pod events first', () => {
  it('flushes before finalizing and stopping the sandbox', async () => {
    const calls = await parkWith(async () => true)

    expect(calls.indexOf('flush')).toBeGreaterThan(-1)
    expect(calls.indexOf('flush')).toBeLessThan(calls.indexOf('finalize'))
    expect(calls).toContain('provider-stop')
  })

  it('refuses the park, keeps the sandbox up and re-arms the idle timer when the flush fails', async () => {
    const calls = await parkWith(async () => false)

    expect(calls).toContain(`${EServeEvent.ParkRefused}:unflushed`)
    expect(calls).not.toContain('finalize')
    expect(calls).not.toContain('provider-stop')
    expect(calls).toContain('park-reopened')
    expect(calls).toContain('rearm-idle')
  })
})

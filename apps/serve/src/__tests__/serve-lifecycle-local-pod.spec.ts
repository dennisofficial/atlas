import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import type { RuntimeWork } from '../runtime-work'
import { createServeLifecycle } from '../serve-lifecycle'
import { bindServeWriteBehind } from '../serve-write-behind'
import { createTurnDriver } from '../turn-driver'
import { fakeServeApp } from './fakes'

const threadId = toThreadId('lifecycle-local-pod')

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

describe('a local pod parks with no API reachable', () => {
  it('finalizes and stops the sandbox without any event flush', async () => {
    const app = fakeServeApp({ threadId, root: '/workspace', intake: true })
    const driver = createTurnDriver({
      app,
      threadId,
      onTurnStarted: () => undefined,
      onTurnEnded: () => undefined,
      onOutcome: () => undefined,
      onFailure: () => undefined,
    })
    const writeBehind = bindServeWriteBehind({
      redeliver: async () => undefined,
      env: {
        ATLAS_CLOUD_URL: 'http://127.0.0.1:9',
        ATLAS_SERVE_TOKEN: 't',
        ATLAS_POD_NAME: 'atlas-pod-1',
      },
      app,
      threadId,
      durableHead: 0,
      remote: {
        controlPlaneUrl: 'http://127.0.0.1:9',
        token: 't',
        clientVersion: 'dev',
        fetchFn: (async () => {
          throw new Error('API unreachable')
        }) as unknown as typeof fetch,
      },
      log: () => undefined,
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
      log: () => undefined,
      work: quiet,
      haltIdle: () => undefined,
      rearmIdle: () => undefined,
      drainDeadlineMs: 100,
      detach: () => undefined,
      stopSandbox: async () => void calls.push('provider-stop'),
      flushEvents: writeBehind?.flush,
      exit: () => void calls.push('exit'),
    })
    await lifecycle.park()

    expect(writeBehind).toBeUndefined()
    expect(calls).toContain('finalize')
    expect(calls).toContain('provider-stop')
    expect(calls).not.toContain('park-reopened')
  })
})

import { describe, expect, it } from 'bun:test'

import { EKilledBy, toThreadId, type EKilledBy as KilledBy } from '@dltech/atlas-core'
import { ERuntimePhase, runtimeCheckpointSchema, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import { createServeLifecycle, PARK_STOP_CYCLE_LIMIT } from '../serve-lifecycle'
import type { RuntimeWork } from '../runtime-work'
import { fakeServeApp } from './fakes'
import { createTurnDriver } from '../turn-driver'

const threadId = toThreadId('lifecycle-owner')

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

type CheckpointFake = {
  current: () => RuntimeCheckpoint | null
  calls: string[]
  phases: ERuntimePhase[]
  parkBegin: (args: { attempts: number }) => Promise<void>
  parkReopened: () => Promise<void>
  finalizePark: () => Promise<void>
}

const fakeCheckpoint = (
  over: { failOn?: ('parkBegin' | 'finalizePark')[] } = {},
): CheckpointFake => {
  const calls: string[] = []
  const phases: ERuntimePhase[] = []
  let held: RuntimeCheckpoint | null = null
  const record = (phase: ERuntimePhase): RuntimeCheckpoint => {
    held = runtimeCheckpointSchema.parse({
      threadId: String(threadId),
      runtimeId: 'runtime-1',
      sandboxSessionId: 'session-1',
      revision: phases.length + 1,
      phase,
      reportedAt: '2026-10-01T00:00:00.000Z',
      transcript: { head: phases.length + 1, count: phases.length + 1, digest: 'a'.repeat(64) },
    })
    return held
  }
  return {
    calls,
    phases,
    current: () => held,
    parkBegin: async () => {
      calls.push('park-begin')
      if (over.failOn?.includes('parkBegin')) throw new Error('disk unavailable')
      phases.push(ERuntimePhase.Parking)
      record(ERuntimePhase.Parking)
    },
    parkReopened: async () => {
      calls.push('park-reopened')
      phases.push(ERuntimePhase.Serving)
      record(ERuntimePhase.Serving)
    },
    finalizePark: async () => {
      calls.push('finalize')
      if (over.failOn?.includes('finalizePark')) throw new Error('disk unavailable')
      phases.push(ERuntimePhase.Parked)
      record(ERuntimePhase.Parked)
    },
  }
}

const fixture = (
  over: {
    work?: () => RuntimeWork
    stop?: (() => Promise<void>) | undefined
    checkpoint?: CheckpointFake
    endProcesses?: ((args: { killedBy: KilledBy }) => Promise<void>) | undefined
  } = {},
) => {
  const app = fakeServeApp({ threadId, root: '/workspace', intake: true })
  if (over.endProcesses !== undefined) app.endProcesses = over.endProcesses
  const driver = createTurnDriver({
    app,
    threadId,
    onTurnStarted: () => undefined,
    onTurnEnded: () => undefined,
    onOutcome: () => undefined,
    onFailure: () => undefined,
  })
  const calls: string[] = []
  const checkpoint = over.checkpoint ?? fakeCheckpoint()
  const lifecycle = createServeLifecycle({
    app,
    driver,
    threadId,
    checkpoint,
    handlers: {
      park: () => {
        calls.push('parked')
      },
      hangUp: () => {
        calls.push('hangup')
      },
    },
    server: {
      stop: async () => {
        calls.push('server-stop')
      },
    },
    bridge: {
      close: () => {
        calls.push('bridge-close')
      },
    },
    log: ({ event }) => {
      calls.push(event)
    },
    work: over.work ?? quiet,
    haltIdle: () => {
      calls.push('halt-idle')
    },
    drainDeadlineMs: 100,
    detach: () => {
      calls.push('detach')
    },
    stopSandbox: over.stop ?? (async () => undefined),
    rearmIdle: () => {
      calls.push('rearm-idle')
    },
    exit: () => {
      calls.push('exit')
    },
  })
  return { app, calls, checkpoint, lifecycle }
}

const gate = () => {
  let open = (): void => undefined
  const done = new Promise<void>((resolve) => {
    open = resolve
  })
  return { done, open }
}

describe('sandbox lifecycle ownership', () => {
  it('records parking before final capture and stops the provider only afterward', async () => {
    const held = gate()
    const checkpoint = fakeCheckpoint()
    const base = checkpoint.finalizePark
    checkpoint.finalizePark = async () => {
      await base()
      await held.done
    }
    const providerCalls: string[] = []
    const test = fixture({
      checkpoint,
      stop: async () => {
        providerCalls.push('provider-stop')
      },
    })
    const parking = test.lifecycle.park()
    for (let step = 0; step < 20 && !checkpoint.phases.includes(ERuntimePhase.Parked); step += 1) {
      await Promise.resolve()
    }
    expect(checkpoint.current()?.phase).toBe(ERuntimePhase.Parked)
    expect(providerCalls).toEqual([])
    expect(test.calls).not.toContain('parked')
    held.open()
    await parking
    expect(providerCalls).toEqual(['provider-stop'])
    expect(checkpoint.phases).toEqual([ERuntimePhase.Parking, ERuntimePhase.Parked])
    expect(checkpoint.calls.indexOf('park-begin')).toBeLessThan(
      checkpoint.calls.indexOf('finalize'),
    )
    expect(test.calls.indexOf('parked')).toBeLessThan(test.calls.indexOf('server-stop'))
    expect(test.app.closed()).toBe(true)
    expect(test.calls.at(-1)).toBe('exit')
  })

  for (const signal of [
    'busy',
    'childrenRunning',
    'shellsRunning',
    'pendingInput',
    'settlingWork',
  ]) {
    it(`refuses final park and reopens to serving when ${signal} became active after the idle check`, async () => {
      let stopped = false
      const test = fixture({
        work: () => ({ ...quiet(), [signal]: signal.endsWith('Running') ? 1 : true }),
        stop: async () => {
          stopped = true
        },
      })
      await test.lifecycle.park()
      expect(stopped).toBe(false)
      expect(test.checkpoint.phases).toEqual([ERuntimePhase.Parking, ERuntimePhase.Serving])
      expect(test.checkpoint.current()?.phase).toBe(ERuntimePhase.Serving)
      expect(test.app.closed()).toBe(false)
      test.app.intake?.dispose()
    })
  }

  it('parks a running service even with a client attached: presence is not work', async () => {
    let stopped = false
    const test = fixture({
      work: () => ({ ...quiet(), servicesRunning: 1, clientsAttached: 1 }),
      stop: async () => {
        stopped = true
      },
    })
    await test.lifecycle.park()
    expect(stopped).toBe(true)
    test.app.intake?.dispose()
  })

  it('parks with a service running once no client is attached, ending it first', async () => {
    const order: string[] = []
    const checkpoint = fakeCheckpoint()
    const baseFinalize = checkpoint.finalizePark
    checkpoint.finalizePark = async () => {
      order.push('finalize')
      await baseFinalize()
    }
    const test = fixture({
      checkpoint,
      work: () => ({ ...quiet(), servicesRunning: 1, clientsAttached: 0 }),
      endProcesses: async () => {
        order.push('endings')
      },
      stop: async () => {
        order.push('provider-stop')
      },
    })
    await test.lifecycle.park()
    expect(order).toEqual(['endings', 'finalize', 'provider-stop'])
    expect(test.calls).toContain('serve.park-finalized')
  })

  it('never reopens admission after finalization even if all provider stop attempts fail, and re-arms the idle timer to retry', async () => {
    let attempts = 0
    const test = fixture({
      stop: async () => {
        attempts += 1
        throw new Error('provider unavailable')
      },
    })
    await test.lifecycle.park()
    expect(attempts).toBe(3)
    expect(test.checkpoint.current()?.phase).toBe(ERuntimePhase.Parked)
    expect(test.calls).toContain('parked')
    expect(test.calls).not.toContain('exit')
    expect(test.app.closed()).toBe(false)
    expect(test.calls).toContain('rearm-idle')
    expect(test.calls.filter((call) => call === 'serve.park-stop-failed')).toHaveLength(4)
    expect(test.calls.lastIndexOf('serve.park-stop-failed')).toBeGreaterThan(
      test.calls.indexOf('rearm-idle'),
    )
    await test.lifecycle.park()
    expect(attempts).toBe(6)
    test.app.intake?.dispose()
  })

  it('exits instead of latching alive forever when the provider stop keeps failing across bounded re-park cycles', async () => {
    let attempts = 0
    const test = fixture({
      stop: async () => {
        attempts += 1
        throw new Error('provider unavailable')
      },
    })
    await test.lifecycle.park()
    await test.lifecycle.park()
    expect(test.calls).not.toContain('exit')
    expect(test.app.closed()).toBe(false)
    await test.lifecycle.park()
    expect(attempts).toBe(9)
    expect(test.calls).toContain('exit')
    expect(test.app.closed()).toBe(true)
    const before = attempts
    await test.lifecycle.park()
    expect(attempts).toBe(before)
    test.app.intake?.dispose()
  })

  it('reopens to serving when the parking capture fails before anything was claimed', async () => {
    let stopped = false
    const test = fixture({
      checkpoint: fakeCheckpoint({ failOn: ['parkBegin'] }),
      stop: async () => {
        stopped = true
      },
    })
    await test.lifecycle.park()
    expect(stopped).toBe(false)
    expect(test.calls).not.toContain('parked')
    expect(test.checkpoint.phases).toEqual([ERuntimePhase.Serving])
    expect(test.checkpoint.current()?.phase).toBe(ERuntimePhase.Serving)
    test.app.intake?.dispose()
  })

  it('reopens admission when durable capture fails before the park was finalized', async () => {
    let stopped = false
    const test = fixture({
      checkpoint: fakeCheckpoint({ failOn: ['finalizePark'] }),
      stop: async () => {
        stopped = true
      },
    })
    await test.lifecycle.park()
    expect(stopped).toBe(false)
    expect(test.calls).not.toContain('parked')
    expect(test.checkpoint.current()?.phase).toBe(ERuntimePhase.Serving)
    test.app.intake?.dispose()
  })

  it('reopens admission and re-arms idle when the pre-finalization park steps fail', async () => {
    const test = fixture({
      endProcesses: async () => {
        throw new Error('processes refused')
      },
      stop: async () => undefined,
    })
    await test.lifecycle.park()
    expect(test.checkpoint.current()?.phase).toBe(ERuntimePhase.Serving)
    expect(test.calls).toContain('rearm-idle')
    expect(test.calls).not.toContain('parked')
    expect(test.app.closed()).toBe(false)
    test.app.intake?.dispose()
  })

  it('drains services with an idle-park ending before the park is finalized', async () => {
    const endings: KilledBy[] = []
    const order: string[] = []
    const checkpoint = fakeCheckpoint()
    const baseFinalize = checkpoint.finalizePark
    checkpoint.finalizePark = async () => {
      order.push('finalize')
      await baseFinalize()
    }
    const test = fixture({
      checkpoint,
      endProcesses: async ({ killedBy }) => {
        endings.push(killedBy)
        order.push('endings')
      },
      stop: async () => {
        order.push('provider-stop')
      },
    })
    await test.lifecycle.park()
    expect(endings).toEqual([EKilledBy.IdlePark])
    expect(order).toEqual(['endings', 'finalize', 'provider-stop'])
    expect(test.calls).toContain('serve.park-finalized')
  })

  it('appends the work snapshot as a parked draft between the parking record and finalization', async () => {
    const order: string[] = []
    const checkpoint = fakeCheckpoint()
    const baseBegin = checkpoint.parkBegin
    checkpoint.parkBegin = async (given) => {
      order.push('park-begin')
      await baseBegin(given)
    }
    const baseFinalize = checkpoint.finalizePark
    checkpoint.finalizePark = async () => {
      order.push('finalize')
      await baseFinalize()
    }
    const test = fixture({
      checkpoint,
      work: () => ({ ...quiet(), turnRunning: true, servicesRunning: 1 }),
      endProcesses: async () => {
        order.push('endings')
      },
      stop: async () => {
        order.push('provider-stop')
      },
    })
    const baseAppend = test.app.log.append
    test.app.log.append = (given) => {
      order.push('append')
      return baseAppend(given)
    }
    await test.lifecycle.park()
    expect(order).toEqual(['park-begin', 'endings', 'append', 'finalize', 'provider-stop'])
    expect(test.app.appended).toContainEqual({
      type: 'parked',
      reason: 'idle',
      turnRunning: true,
      childrenRunning: 0,
      shellsRunning: 0,
      servicesRunning: 1,
      clientsAttached: 0,
    })
  })

  it('publishes events-appended for the parked marker so attached clients refresh before the socket parks', async () => {
    const test = fixture({ stop: async () => undefined })
    const seen: string[] = []
    const unsubscribe = test.app.channel.subscribe({
      threadId,
      listener: (signal) => {
        seen.push(signal.type)
      },
    })
    await test.lifecycle.park()
    unsubscribe()
    expect(seen).toContain('events-appended')
  })

  it('still completes the park when the parked append rejects', async () => {
    let stopped = false
    const test = fixture({
      stop: async () => {
        stopped = true
      },
    })
    test.app.log.append = () => Promise.reject(new Error('disk full'))
    await test.lifecycle.park()
    expect(stopped).toBe(true)
    expect(test.calls).toContain('parked')
    expect(test.calls.at(-1)).toBe('exit')
  })

  it('exits bounded after the park finalized, so a wake of the still-live sandbox boots a fresh serve', async () => {
    let attempts = 0
    const test = fixture({
      stop: async () => {
        attempts += 1
        throw new Error('provider unavailable')
      },
    })

    for (let cycle = 0; cycle < PARK_STOP_CYCLE_LIMIT; cycle += 1) {
      await test.lifecycle.park()
    }

    expect(attempts).toBe(3 * PARK_STOP_CYCLE_LIMIT)
    expect(test.checkpoint.current()?.phase).toBe(ERuntimePhase.Parked)
    expect(test.calls).toContain('parked')
    expect(test.calls.at(-1)).toBe('exit')
    expect(test.app.closed()).toBe(true)
  })

  it('actual shutdown retains cleanup and is idempotent', async () => {
    const test = fixture()
    await Promise.all([
      test.lifecycle.close({ reason: 'SIGTERM' }),
      test.lifecycle.close({ reason: 'owner-shutdown' }),
    ])
    expect(test.calls.filter((call) => call === 'server-stop')).toHaveLength(1)
    expect(test.app.closed()).toBe(true)
  })
})

import { describe, expect, it } from 'bun:test'

import { EKilledBy, toThreadId, type EKilledBy as KilledBy } from '@dltech/atlas-core'

import { createServeLifecycle } from '../serve-lifecycle'
import type { RuntimeWork } from '../runtime-work'
import { fakeServeApp } from './fakes'
import { createTurnDriver } from '../turn-driver'

const threadId = toThreadId('lifecycle-owner')

const quiet = (): RuntimeWork => ({
  turnRunning: false, busy: false, childrenRunning: 0, shellsRunning: 0,
  servicesRunning: 0, pendingInput: false, settlingWork: false, clientsAttached: 0,
})

const fixture = (over: {
  work?: () => RuntimeWork
  stop?: (() => Promise<void>) | undefined
  finalize?: (() => Promise<void>) | undefined
  endProcesses?: ((args: { killedBy: KilledBy }) => Promise<void>) | undefined
} = {}) => {
  const app = fakeServeApp({ threadId, root: '/workspace', intake: true })
  if (over.endProcesses !== undefined) app.endProcesses = over.endProcesses
  const driver = createTurnDriver({
    app, threadId, onTurnStarted: () => undefined, onTurnEnded: () => undefined,
    onOutcome: () => undefined, onFailure: () => undefined,
  })
  const calls: string[] = []
  const admission = { closed: false }
  const lifecycle = createServeLifecycle({
    app, driver, threadId, admission,
    handlers: { park: () => { calls.push('parked') }, hangUp: () => { calls.push('hangup') } },
    server: { stop: async () => { calls.push('server-stop') } },
    bridge: { close: () => { calls.push('bridge-close') } },
    log: ({ event }) => { calls.push(event) },
    work: over.work ?? quiet,
    haltIdle: () => { calls.push('halt-idle') },
    drainDeadlineMs: 100,
    detach: () => { calls.push('detach') },
    stopSandbox: over.stop,
    finalizePark: over.finalize,
    exit: () => { calls.push('exit') },
  })
  return { app, calls, admission, lifecycle }
}

const gate = () => {
  let open = (): void => undefined
  const done = new Promise<void>((resolve) => { open = resolve })
  return { done, open }
}

describe('sandbox lifecycle ownership', () => {
  it('closes admission before final capture and stops the provider only afterward', async () => {
    const held = gate()
    const calls: string[] = []
    const test = fixture({
      finalize: async () => { calls.push('finalize'); await held.done },
      stop: async () => { calls.push('provider-stop') },
    })
    const parking = test.lifecycle.park()
    for (let step = 0; step < 20 && !calls.includes('finalize'); step += 1) await Promise.resolve()
    expect(test.admission.closed).toBe(true)
    expect(calls).toEqual(['finalize'])
    expect(test.calls).not.toContain('parked')
    held.open()
    await parking
    expect(calls).toEqual(['finalize', 'provider-stop'])
    expect(test.calls.indexOf('parked')).toBeLessThan(test.calls.indexOf('server-stop'))
    expect(test.app.closed()).toBe(true)
    expect(test.calls.at(-1)).toBe('exit')
  })

  for (const signal of ['busy', 'childrenRunning', 'shellsRunning', 'pendingInput', 'settlingWork']) {
    it(`refuses final park when ${signal} became active after the idle check`, async () => {
      let stopped = false
      const test = fixture({
        work: () => ({ ...quiet(), [signal]: signal.endsWith('Running') ? 1 : true }),
        stop: async () => { stopped = true },
      })
      await test.lifecycle.park()
      expect(stopped).toBe(false)
      expect(test.admission.closed).toBe(false)
      expect(test.app.closed()).toBe(false)
      test.app.intake?.dispose()
    })
  }

  it('refuses final park when a service is running with a client still attached', async () => {
    let stopped = false
    const test = fixture({
      work: () => ({ ...quiet(), servicesRunning: 1, clientsAttached: 1 }),
      stop: async () => { stopped = true },
    })
    await test.lifecycle.park()
    expect(stopped).toBe(false)
    expect(test.admission.closed).toBe(false)
    test.app.intake?.dispose()
  })

  it('parks with a service running once no client is attached, ending it first', async () => {
    const order: string[] = []
    const test = fixture({
      work: () => ({ ...quiet(), servicesRunning: 1, clientsAttached: 0 }),
      endProcesses: async () => { order.push('endings') },
      finalize: async () => { order.push('finalize') },
      stop: async () => { order.push('provider-stop') },
    })
    await test.lifecycle.park()
    expect(order).toEqual(['endings', 'finalize', 'provider-stop'])
    expect(test.calls).toContain('serve.park-finalized')
  })

  it('never reopens admission after finalization even if all provider stop attempts fail', async () => {
    let attempts = 0
    const test = fixture({
      finalize: async () => undefined,
      stop: async () => { attempts += 1; throw new Error('provider unavailable') },
    })
    await test.lifecycle.park()
    expect(attempts).toBe(3)
    expect(test.admission.closed).toBe(true)
    expect(test.calls).toContain('parked')
    expect(test.calls).not.toContain('exit')
    expect(test.app.closed()).toBe(false)
    test.app.intake?.dispose()
  })

  it('never publishes a finalized park when durable capture fails', async () => {
    let stopped = false
    const test = fixture({
      finalize: async () => { throw new Error('disk unavailable') },
      stop: async () => { stopped = true },
    })
    await test.lifecycle.park()
    expect(stopped).toBe(false)
    expect(test.calls).not.toContain('parked')
    expect(test.admission.closed).toBe(true)
    test.app.intake?.dispose()
  })

  it('drains services with an idle-park ending before the park is finalized', async () => {
    const endings: KilledBy[] = []
    const order: string[] = []
    const test = fixture({
      endProcesses: async ({ killedBy }) => { endings.push(killedBy); order.push('endings') },
      finalize: async () => { order.push('finalize') },
      stop: async () => { order.push('provider-stop') },
    })
    await test.lifecycle.park()
    expect(endings).toEqual([EKilledBy.IdlePark])
    expect(order).toEqual(['endings', 'finalize', 'provider-stop'])
    expect(test.calls).toContain('serve.park-finalized')
  })

  it('legacy idle exit closes without claiming finalized park', async () => {
    const test = fixture()
    await test.lifecycle.park()
    expect(test.calls).not.toContain('serve.park-finalized')
    expect(test.calls).not.toContain('parked')
    expect(test.app.closed()).toBe(true)
  })

  it('appends the work snapshot as a parked draft between endings and finalization', async () => {
    const order: string[] = []
    const test = fixture({
      work: () => ({ ...quiet(), turnRunning: true, servicesRunning: 1 }),
      endProcesses: async () => { order.push('endings') },
      finalize: async () => { order.push('finalize') },
      stop: async () => { order.push('provider-stop') },
    })
    const baseAppend = test.app.log.append
    test.app.log.append = (given) => {
      order.push('append')
      return baseAppend(given)
    }
    await test.lifecycle.park()
    expect(order).toEqual(['endings', 'append', 'finalize', 'provider-stop'])
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
    const test = fixture({
      finalize: async () => undefined,
      stop: async () => undefined,
    })
    const seen: string[] = []
    const unsubscribe = test.app.channel.subscribe({
      threadId,
      listener: (signal) => { seen.push(signal.type) },
    })
    await test.lifecycle.park()
    unsubscribe()
    expect(seen).toContain('events-appended')
  })

  it('still completes the park when the parked append rejects', async () => {
    let stopped = false
    const test = fixture({
      finalize: async () => undefined,
      stop: async () => { stopped = true },
    })
    test.app.log.append = () => Promise.reject(new Error('disk full'))
    await test.lifecycle.park()
    expect(stopped).toBe(true)
    expect(test.calls).toContain('parked')
    expect(test.calls.at(-1)).toBe('exit')
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

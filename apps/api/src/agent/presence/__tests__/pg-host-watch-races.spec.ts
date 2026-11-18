import { describe, expect, it } from 'bun:test'

import type { PgPresenceClient } from '../pg-host-presence'
import { startHostWatch } from '../pg-host-watch'

type FakeClient = PgPresenceClient & { waiting: boolean; ended: boolean; die(): void }

const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 400; i += 1) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('condition never held')
}

const gate = (): { wait: Promise<void>; open(): void } => {
  let open!: () => void
  const wait = new Promise<void>((resolve) => (open = resolve))
  return { wait, open }
}

const makeFleet = (args: { peers: number[]; notifyFails?: boolean; endGate?: Promise<void> }) => {
  const clients: FakeClient[] = []
  const alive = new Set(args.peers)
  let maxWaiting = 0
  const waitingNow = (): number => clients.filter((c) => c.waiting && !c.ended).length
  const createClient = (): FakeClient => {
    let release: (() => void) | undefined
    let reject: ((error: Error) => void) | undefined
    let target: number | undefined
    const client: FakeClient = {
      waiting: false,
      ended: false,
      die: () => {
        if (target !== undefined) alive.delete(target)
        release?.()
      },
      connect: () => Promise.resolve(),
      query: (text) => {
        if (text.includes('pg_advisory_lock_shared')) {
          client.waiting = true
          maxWaiting = Math.max(maxWaiting, waitingNow())
          return new Promise((resolve, fail) => {
            release = () => {
              client.waiting = false
              resolve({ rows: [] })
            }
            reject = fail
          })
        }
        if (text.includes('"v2"."V2Host" WHERE id <>')) {
          target = [...alive].sort((a, b) => a - b)[0]
          return Promise.resolve({ rows: target === undefined ? [] : [{ id: target }] })
        }
        if (text.includes('pg_notify') && args.notifyFails === true) {
          return Promise.reject(new Error('connection lost'))
        }
        return Promise.resolve({ rows: [] })
      },
      end: async () => {
        if (clients.indexOf(client) === 0 && args.endGate !== undefined) await args.endGate
        client.ended = true
        client.waiting = false
        reject?.(new Error('terminated'))
      },
      on: () => undefined,
    }
    clients.push(client)
    return client
  }
  return { clients, createClient, waitingNow, maxWaiting: () => maxWaiting }
}

const countingRing = () => {
  let rings = 0
  return {
    rings: () => rings,
    ring: () => {
      rings += 1
    },
  }
}

describe('pg host watch races', () => {
  it('a death whose reap fails half-way still rings', async () => {
    const fleet = makeFleet({ peers: [2], notifyFails: true })
    const counter = countingRing()
    const watch = startHostWatch({
      url: 'postgres://unused',
      selfId: () => 1,
      ring: counter.ring,
      onHostChange: () => () => undefined,
      createClient: fleet.createClient,
    })
    await until(() => fleet.waitingNow() === 1)
    fleet.clients[0]?.die()
    await until(() => counter.rings() === 1)
    await watch.close()
  })

  it('every death rings once, even with recomputes in between', async () => {
    const fleet = makeFleet({ peers: [2, 3] })
    const counter = countingRing()
    const watch = startHostWatch({
      url: 'postgres://unused',
      selfId: () => 1,
      ring: counter.ring,
      onHostChange: () => () => undefined,
      createClient: fleet.createClient,
    })
    await until(() => fleet.waitingNow() === 1)
    fleet.clients[0]?.die()
    await new Promise((resolve) => setTimeout(resolve, 20))
    watch.recompute()
    watch.recompute()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await until(() => fleet.waitingNow() === 1)
    expect(counter.rings()).toBe(1)
    fleet.clients.find((c) => c.waiting)?.die()
    await until(() => counter.rings() === 2)
    await watch.close()
  })

  it('overlapping recomputes never leave two waiters, and close awaits the teardown', async () => {
    const endGate = gate()
    const fleet = makeFleet({ peers: [2], endGate: endGate.wait })
    const counter = countingRing()
    const watch = startHostWatch({
      url: 'postgres://unused',
      selfId: () => 1,
      ring: counter.ring,
      onHostChange: () => () => undefined,
      createClient: fleet.createClient,
    })
    await until(() => fleet.waitingNow() === 1)
    watch.recompute()
    watch.recompute()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fleet.maxWaiting()).toBe(1)

    let closed = false
    const closing = watch.close().then(() => {
      closed = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(closed).toBe(false)
    endGate.open()
    await closing
    expect(fleet.waitingNow()).toBe(0)
    expect(fleet.maxWaiting()).toBe(1)
  })
})

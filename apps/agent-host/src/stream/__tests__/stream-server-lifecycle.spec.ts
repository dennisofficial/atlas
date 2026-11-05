import { afterEach, describe, expect, it } from 'bun:test'

import { EStreamErrorCode, STREAM_PROTOCOL_VERSION, EStreamClose } from '@dltech/atlas-protocol'

import { STREAM_AUTH_RECHECK_MS, STREAM_MAX_CONNECTIONS_PER_USER } from '../stream-limits'
import { StreamHarness } from './stream-harness'
import { until } from './test-client'

describe('stream server lifecycle', () => {
  let harness: StreamHarness

  afterEach(async () => {
    await harness.dispose()
  })

  it('refuses the connection past the per-user cap and keeps other users out of the count', async () => {
    harness = new StreamHarness()
    for (let index = 0; index < STREAM_MAX_CONNECTIONS_PER_USER; index += 1) await harness.ready()
    const over = harness.connect()
    over.send({ type: 'hello', v: STREAM_PROTOCOL_VERSION, token: 'tok-a' })
    expect(await over.next()).toEqual({ type: 'error', code: EStreamErrorCode.ForbiddenLimit })
    expect(await over.waitClosed()).toBe(1008)
    const other = await harness.ready({ token: 'tok-b' })
    expect(other.isClosed).toBe(false)
  })

  it('frees a slot when a connection closes', async () => {
    harness = new StreamHarness()
    const first = await harness.ready()
    for (let index = 1; index < STREAM_MAX_CONNECTIONS_PER_USER; index += 1) await harness.ready()
    first.close()
    await until(
      () => harness.server.connections() === STREAM_MAX_CONNECTIONS_PER_USER - 1,
      'the slot to free',
    )
    await harness.ready()
  })

  it('re-checks auth on a timer, keeps a valid session and closes a revoked one with 4401', async () => {
    harness = new StreamHarness()
    const kept = await harness.ready({ token: 'tok-b' })
    const revoked = await harness.ready({ token: 'tok-a' })
    harness.timers.advance(STREAM_AUTH_RECHECK_MS)
    await Bun.sleep(20)
    expect(kept.isClosed).toBe(false)
    expect(harness.timers.pendingCount()).toBe(2)
    harness.auth.revoke({ token: 'tok-a' })
    harness.timers.advance(STREAM_AUTH_RECHECK_MS)
    expect(await revoked.waitClosed()).toBe(EStreamClose.Unauthenticated)
    expect(kept.isClosed).toBe(false)
    await until(
      () => harness.timers.pendingCount() === 1,
      'the closed connection to clear its timer',
    )
  })

  it('drain sends going-away, closes 1001, then healthz and upgrades answer 503', async () => {
    harness = new StreamHarness()
    harness.timers.randomValue = 0.4
    const clients = [await harness.ready(), await harness.ready({ token: 'tok-b' })]
    await harness.server.drain({})
    for (const client of clients) {
      expect(await client.next()).toEqual({ type: 'going-away', reconnectAfterMs: 2_000 })
      expect(await client.waitClosed()).toBe(EStreamClose.GoingAway)
    }
    expect(harness.server.connections()).toBe(0)
    expect(harness.timers.pendingCount()).toBe(0)
    const health = await fetch(`${harness.httpUrl}/healthz`)
    expect(health.status).toBe(503)
    expect((await harness.upgradeAttempt()).status).toBe(503)
  })

  it('drain with no connections resolves at once', async () => {
    harness = new StreamHarness()
    await harness.server.drain({})
    expect(harness.timers.pendingCount()).toBe(0)
  })

  it('stop closes every socket and leaves no timer behind', async () => {
    harness = new StreamHarness()
    const client = await harness.ready()
    const pending = harness.connect()
    await until(() => harness.server.connections() === 2, 'both sockets to open')
    await harness.server.stop()
    expect(await client.waitClosed()).toBeGreaterThan(0)
    expect(await pending.waitClosed()).toBeGreaterThan(0)
    expect(harness.timers.pendingCount()).toBe(0)
  })
})

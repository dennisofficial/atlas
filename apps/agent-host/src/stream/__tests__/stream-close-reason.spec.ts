import { afterEach, describe, expect, it } from 'bun:test'

import { EStreamClose, STREAM_PROTOCOL_VERSION } from '@dltech/atlas-protocol'

import { STREAM_MAX_CONNECTIONS_PER_USER } from '../stream-limits'
import { StreamHarness } from './stream-harness'

describe('stream close reason', () => {
  let harness: StreamHarness

  afterEach(async () => {
    await harness.dispose()
  })

  it('sends closing with the code before closing a bad token', async () => {
    harness = new StreamHarness()
    const client = harness.connect()
    client.send({ type: 'hello', v: STREAM_PROTOCOL_VERSION, token: 'not-granted' })
    expect(await client.next()).toEqual({ type: 'closing', code: EStreamClose.Unauthenticated })
    expect(await client.waitClosed()).toBe(EStreamClose.Unauthenticated)
  })

  it('sends closing after going-away on drain', async () => {
    harness = new StreamHarness()
    const client = await harness.ready()
    await harness.server.drain({ reconnectAfterMs: 0 })
    expect(await client.next()).toEqual({ type: 'going-away', reconnectAfterMs: 0 })
    expect(await client.next()).toEqual({ type: 'closing', code: EStreamClose.GoingAway })
  })

  it('sends closing with the policy code past the per-user cap', async () => {
    harness = new StreamHarness()
    for (let index = 0; index < STREAM_MAX_CONNECTIONS_PER_USER; index += 1) await harness.ready()
    const over = harness.connect()
    over.send({ type: 'hello', v: STREAM_PROTOCOL_VERSION, token: 'tok-a' })
    expect((await over.next()).type).toBe('error')
    expect(await over.next()).toEqual({ type: 'closing', code: 1008 })
  })
})

import { afterEach, describe, expect, it } from 'bun:test'

import {
  EStreamClose,
  EStreamErrorCode,
  STREAM_HELLO_TIMEOUT_MS,
  STREAM_MAX_CLIENT_FRAME_BYTES,
  STREAM_PROTOCOL_VERSION,
} from '@dltech/atlas-protocol'

import { StreamHarness } from './stream-harness'
import { until } from './test-client'

describe('stream server http surface', () => {
  let harness: StreamHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  it('answers healthz with the connection count', async () => {
    harness = new StreamHarness()
    const response = await fetch(`${harness.httpUrl}/healthz`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, connections: 0 })
  })

  it('404s unknown paths and 426s a plain GET on /stream', async () => {
    harness = new StreamHarness()
    expect((await fetch(`${harness.httpUrl}/nope`)).status).toBe(404)
    expect((await fetch(`${harness.httpUrl}/stream`)).status).toBe(426)
  })

  it('refuses a listed-origin mismatch with 403 and admits a listed origin', async () => {
    harness = new StreamHarness({ trustedOrigins: ['https://app.byatlas.io'] })
    const refused = await harness.upgradeAttempt({ headers: { Origin: 'https://evil.example' } })
    expect(refused.status).toBe(403)
    const client = harness.connect({ headers: { Origin: 'https://app.byatlas.io' } })
    client.send({ type: 'hello', v: STREAM_PROTOCOL_VERSION, token: 'tok-a' })
    expect((await client.next()).type).toBe('ready')
  })

  it('admits any origin when none are listed', async () => {
    harness = new StreamHarness()
    const client = harness.connect({ headers: { Origin: 'https://anything.example' } })
    client.send({ type: 'hello', v: STREAM_PROTOCOL_VERSION, token: 'tok-a' })
    expect((await client.next()).type).toBe('ready')
  })
})

describe('stream server connection', () => {
  let harness: StreamHarness

  afterEach(async () => {
    await harness.dispose()
  })

  it('answers hello with ready and counts the connection', async () => {
    harness = new StreamHarness()
    const client = await harness.ready()
    expect(harness.server.connections()).toBe(1)
    client.close()
    await until(() => harness.server.connections() === 0, 'the connection to drop')
  })

  it('talks down to our version when the client is newer', async () => {
    harness = new StreamHarness()
    const client = harness.connect()
    client.send({ type: 'hello', v: STREAM_PROTOCOL_VERSION + 4, token: 'tok-a' })
    expect(await client.next()).toMatchObject({ type: 'ready', v: STREAM_PROTOCOL_VERSION })
  })

  it('closes 4401 when no hello arrives in time and owns no timer afterwards', async () => {
    harness = new StreamHarness()
    const client = harness.connect()
    await until(() => harness.timers.pendingCount() > 0, 'the hello timer')
    harness.timers.advance(STREAM_HELLO_TIMEOUT_MS)
    expect(await client.waitClosed()).toBe(EStreamClose.Unauthenticated)
    await until(() => harness.timers.pendingCount() === 0, 'timers to clear')
  })

  it('stops the hello timer once hello arrives', async () => {
    harness = new StreamHarness()
    const client = await harness.ready()
    harness.timers.advance(STREAM_HELLO_TIMEOUT_MS * 2)
    expect(client.isClosed).toBe(false)
  })

  it('closes 4401 on an unknown token', async () => {
    harness = new StreamHarness()
    const client = harness.connect()
    client.send({ type: 'hello', v: STREAM_PROTOCOL_VERSION, token: 'nobody' })
    expect(await client.waitClosed()).toBe(EStreamClose.Unauthenticated)
  })

  it('closes 4401 when the first frame is not hello', async () => {
    harness = new StreamHarness()
    const client = harness.connect()
    client.send({ type: 'ping' })
    expect(await client.waitClosed()).toBe(EStreamClose.Unauthenticated)
  })

  it('answers ping with pong', async () => {
    harness = new StreamHarness()
    const client = await harness.ready()
    client.send({ type: 'ping' })
    expect(await client.next()).toEqual({ type: 'pong' })
  })

  it('rejects an oversize frame with bad-frame then 1009', async () => {
    harness = new StreamHarness()
    const client = await harness.ready()
    client.send('x'.repeat(STREAM_MAX_CLIENT_FRAME_BYTES + 1))
    expect(await client.next()).toEqual({ type: 'error', code: EStreamErrorCode.BadFrame })
    expect(await client.waitClosed()).toBe(1009)
  })

  it('answers malformed frames with bad-frame and stays open', async () => {
    harness = new StreamHarness()
    const client = await harness.ready()
    client.send('{not json')
    expect(await client.next()).toEqual({ type: 'error', code: EStreamErrorCode.BadFrame })
    client.send({ type: 'subscribe' })
    expect(await client.next()).toEqual({ type: 'error', code: EStreamErrorCode.BadFrame })
    client.send({ type: 'ping' })
    expect(await client.next()).toEqual({ type: 'pong' })
  })

  it('ignores an unknown frame kind', async () => {
    harness = new StreamHarness()
    const client = await harness.ready()
    client.send({ type: 'teleport', id: 'x' })
    client.send({ type: 'ping' })
    expect(await client.next()).toEqual({ type: 'pong' })
  })

  it('routes subscription frames to the stub, which answers internal', async () => {
    harness = new StreamHarness()
    const client = await harness.ready()
    client.send({ type: 'subscribe', id: 'sub-1', kind: 'session', sessionId: 's1' })
    expect(await client.next()).toEqual({
      type: 'error',
      id: 'sub-1',
      code: EStreamErrorCode.Internal,
    })
    client.send({ type: 'unsubscribe', id: 'sub-1' })
    expect(await client.next()).toEqual({
      type: 'error',
      id: 'sub-1',
      code: EStreamErrorCode.Internal,
    })
    client.send({ type: 'resnap', id: 'sub-9' })
    expect(await client.next()).toEqual({
      type: 'error',
      id: 'sub-9',
      code: EStreamErrorCode.Internal,
    })
  })
})

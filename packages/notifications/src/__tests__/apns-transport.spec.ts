import { describe, expect, it } from 'bun:test'
import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto'

import { ENotifyMoment, type AtlasNotification } from '@dltech/atlas-core'

import { ENotifyDeviceKind, type NotifyDevice } from '../model'
import {
  APNS_COLLAPSE_LIMIT,
  APNS_TOKEN_TTL_MS,
  apnsCollapseIdOf,
  apnsTransport,
  type ApnsReply,
  type ApnsRequest,
} from '../transports/apns'

const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })

const KEY_P8 = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

const PUBLIC_KEY = createPublicKey(keys.privateKey)

const NOTIFICATION: AtlasNotification = {
  sessionId: 'session-1',
  seq: 7,
  moment: ENotifyMoment.TurnFinished,
  title: 'Fix the parser',
  body: 'The turn finished.',
  at: '2026-11-23T14:02:00.000Z',
}

const deviceOf = (overrides: Partial<NotifyDevice> = {}): NotifyDevice => ({
  id: 'device-1',
  kind: ENotifyDeviceKind.ApnsMac,
  token: 'a'.repeat(64),
  secret: null,
  ...overrides,
})

type Recorded = { sent: ApnsRequest[]; send: (request: ApnsRequest) => Promise<ApnsReply> }

const recorderOf = (reply: () => Promise<ApnsReply> = async () => ({ status: 200 })): Recorded => {
  const sent: ApnsRequest[] = []
  return {
    sent,
    send: async (request) => {
      sent.push(request)
      return reply()
    },
  }
}

const claimsOf = (authorization: string): Record<string, unknown> => {
  const jwt = authorization.replace(/^bearer /, '')
  const [, claims, signature] = jwt.split('.')
  if (claims === undefined || signature === undefined) throw new Error(`bad token ${jwt}`)
  const verified = createVerify('sha256')
    .update(jwt.slice(0, jwt.lastIndexOf('.')))
    .verify({ key: PUBLIC_KEY, dsaEncoding: 'ieee-p1363' }, signature, 'base64url')
  if (!verified) throw new Error('the provider token does not verify')
  return JSON.parse(Buffer.from(claims, 'base64url').toString()) as Record<string, unknown>
}

const headerOf = (authorization: string): Record<string, unknown> => {
  const [header] = authorization.replace(/^bearer /, '').split('.')
  if (header === undefined) throw new Error('no token header')
  return JSON.parse(Buffer.from(header, 'base64url').toString()) as Record<string, unknown>
}

const transportOf = (args: { recorded: Recorded; clock?: () => number }) =>
  apnsTransport({
    keyP8: KEY_P8,
    keyId: 'XS4K72SNYH',
    teamId: '9H7HK25CVR',
    topic: 'io.byatlas.mac',
    send: args.recorded.send,
    ...(args.clock === undefined ? {} : { clock: args.clock }),
  })

describe('apnsTransport.deliver', () => {
  it('posts an alert with the topic, the push type and the session as the collapse id', async () => {
    const recorded = recorderOf()

    const results = await transportOf({ recorded }).deliver({
      devices: [deviceOf()],
      notification: NOTIFICATION,
    })

    expect(results).toEqual([{ deviceId: 'device-1', sent: true }])
    const request = recorded.sent[0]
    expect(request?.token).toBe('a'.repeat(64))
    expect(request?.headers['apns-topic']).toBe('io.byatlas.mac')
    expect(request?.headers['apns-push-type']).toBe('alert')
    expect(request?.headers['apns-collapse-id']).toBe('session-1')
    expect(JSON.parse(request?.body ?? '{}')).toEqual({
      aps: {
        alert: { title: 'Fix the parser', body: 'The turn finished.' },
        'thread-id': 'session-1',
        sound: 'default',
      },
      sessionId: 'session-1',
      seq: 7,
    })
  })

  it('omits the sound of a notification that must not make one', async () => {
    const recorded = recorderOf()

    await transportOf({ recorded }).deliver({
      devices: [deviceOf()],
      notification: { ...NOTIFICATION, silent: true },
    })

    const body = JSON.parse(recorded.sent[0]?.body ?? '{}') as { aps: Record<string, unknown> }
    expect(body.aps).not.toHaveProperty('sound')
    expect(body.aps['thread-id']).toBe('session-1')
  })

  it('signs its provider token with the key id and the team as the issuer', async () => {
    const recorded = recorderOf()

    await transportOf({ recorded, clock: () => 0 }).deliver({
      devices: [deviceOf()],
      notification: NOTIFICATION,
    })

    const authorization = recorded.sent[0]?.headers['authorization'] ?? ''
    expect(headerOf(authorization)).toEqual({ alg: 'ES256', kid: 'XS4K72SNYH' })
    expect(claimsOf(authorization)).toEqual({ iss: '9H7HK25CVR', iat: 0 })
  })

  it('keeps one provider token for fifty minutes and mints a new one after', async () => {
    const recorded = recorderOf()
    let now = 1_700_000_000_000
    const transport = transportOf({ recorded, clock: () => now })

    await transport.deliver({ devices: [deviceOf()], notification: NOTIFICATION })
    now += APNS_TOKEN_TTL_MS - 1
    await transport.deliver({ devices: [deviceOf()], notification: NOTIFICATION })
    now += 2
    await transport.deliver({ devices: [deviceOf()], notification: NOTIFICATION })

    expect(recorded.sent[0]?.headers['authorization']).toBe(
      recorded.sent[1]?.headers['authorization'],
    )
    expect(recorded.sent[2]?.headers['authorization']).not.toBe(
      recorded.sent[1]?.headers['authorization'],
    )
  })

  it('reports a 410 as gone, and an unregistered reason as gone too', async () => {
    const expired = recorderOf(async () => ({ status: 410 }))
    const rejected = recorderOf(async () => ({ status: 400, reason: 'Unregistered' }))
    const bad = recorderOf(async () => ({ status: 400, reason: 'BadDeviceToken' }))
    const refused = recorderOf(async () => ({ status: 429, reason: 'TooManyRequests' }))

    for (const recorded of [expired, rejected, bad]) {
      const results = await transportOf({ recorded }).deliver({
        devices: [deviceOf()],
        notification: NOTIFICATION,
      })
      expect(results).toEqual([{ deviceId: 'device-1', sent: false, gone: true }])
    }
    expect(
      await transportOf({ recorded: refused }).deliver({
        devices: [deviceOf()],
        notification: NOTIFICATION,
      }),
    ).toEqual([{ deviceId: 'device-1', sent: false }])
  })

  it('reports a device unsent when the request never reaches Apple', async () => {
    const recorded = recorderOf(async () => {
      throw new Error('offline')
    })

    expect(
      await transportOf({ recorded }).deliver({
        devices: [deviceOf()],
        notification: NOTIFICATION,
      }),
    ).toEqual([{ deviceId: 'device-1', sent: false }])
  })
})

describe('apnsTransport.clear', () => {
  it('posts a background push with no alert', async () => {
    const recorded = recorderOf()

    const results = await transportOf({ recorded }).clear({
      devices: [deviceOf()],
      sessionId: 'session-1',
    })

    expect(results).toEqual([{ deviceId: 'device-1', sent: true }])
    const request = recorded.sent[0]
    expect(request?.headers['apns-push-type']).toBe('background')
    expect(request?.headers['apns-priority']).toBe('5')
    expect(request?.headers['apns-topic']).toBe('io.byatlas.mac')
    expect(request?.headers['apns-collapse-id']).toBeUndefined()
    expect(JSON.parse(request?.body ?? '{}')).toEqual({
      aps: { 'content-available': 1 },
      clearSessionId: 'session-1',
    })
  })
})

describe('apnsCollapseIdOf', () => {
  it('keeps a short session id and cuts a long one to the byte limit', () => {
    expect(apnsCollapseIdOf('session-1')).toBe('session-1')
    const long = apnsCollapseIdOf('s'.repeat(100))
    expect(Buffer.byteLength(long)).toBe(APNS_COLLAPSE_LIMIT)
  })
})

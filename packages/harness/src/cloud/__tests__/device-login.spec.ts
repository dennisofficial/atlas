import { describe, expect, it } from 'bun:test'

import { CloudError } from '../cloud-client'
import {
  beginCloudLogin,
  ECloudLoginPoll,
  pollCloudLogin,
  type CloudLoginTicket,
} from '../device-login'

const URL = 'http://cloud.test'

const responding =
  (status: number, body?: unknown): typeof fetch =>
  (() =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )) as unknown as typeof fetch

const deviceCodeBody = {
  device_code: 'dev_code_1',
  user_code: 'ABCD-EFGH',
  verification_uri: 'http://cloud.test/device',
  verification_uri_complete: 'http://cloud.test/device?user_code=ABCD-EFGH',
  expires_in: 300,
  interval: 5,
}

const ticket: CloudLoginTicket = {
  url: URL,
  deviceCode: 'dev_code_1',
  userCode: 'ABCD-EFGH',
  verificationUrl: 'http://cloud.test/device?user_code=ABCD-EFGH',
  expiresInMs: 300_000,
  intervalMs: 5_000,
}

describe('beginCloudLogin', () => {
  it('maps the snake_case response onto the ticket', async () => {
    const result = await beginCloudLogin({ url: URL, fetchFn: responding(200, deviceCodeBody) })

    expect(result).toEqual(ticket)
  })

  it('falls back to verification_uri when the complete one is absent', async () => {
    const { verification_uri_complete: _complete, ...body } = deviceCodeBody

    const result = await beginCloudLogin({ url: URL, fetchFn: responding(200, body) })

    expect(result.verificationUrl).toBe('http://cloud.test/device')
  })

  it('posts the atlas-tui client id', async () => {
    let seen: unknown
    const fetchFn = (async (_input: unknown, init?: RequestInit) => {
      seen = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      return new Response(JSON.stringify(deviceCodeBody), { status: 200 })
    }) as typeof fetch

    await beginCloudLogin({ url: URL, fetchFn })

    expect(seen).toEqual({ client_id: 'atlas-tui' })
  })

  it('throws a CloudError when the endpoint refuses', async () => {
    const failure = await beginCloudLogin({
      url: URL,
      fetchFn: responding(500, { message: 'boom' }),
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(500)
  })

  it('throws a CloudError when the host cannot be reached', async () => {
    const down = (() =>
      Promise.reject(new Error('connection refused'))) as unknown as typeof fetch

    const failure = await beginCloudLogin({ url: URL, fetchFn: down }).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(0)
    expect((failure as CloudError).message).toContain('is the cloud API running?')
  })
})

describe('pollCloudLogin', () => {
  it('maps a 200 to an approved outcome carrying the token', async () => {
    const outcome = await pollCloudLogin({
      ticket,
      fetchFn: responding(200, { access_token: 'sess_new', token_type: 'Bearer', expires_in: 3600 }),
    })

    expect(outcome).toEqual({ status: ECloudLoginPoll.Approved, token: 'sess_new' })
  })

  it('posts the device-code grant', async () => {
    let seen: unknown
    const fetchFn = (async (_input: unknown, init?: RequestInit) => {
      seen = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      return new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 400 })
    }) as typeof fetch

    await pollCloudLogin({ ticket, fetchFn })

    expect(seen).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: 'dev_code_1',
      client_id: 'atlas-tui',
    })
  })

  it.each([
    ['authorization_pending', ECloudLoginPoll.Pending],
    ['slow_down', ECloudLoginPoll.SlowDown],
    ['access_denied', ECloudLoginPoll.Denied],
    ['expired_token', ECloudLoginPoll.Expired],
  ])('maps %s to %s', async (error, expected) => {
    const outcome = await pollCloudLogin({ ticket, fetchFn: responding(400, { error }) })

    expect(outcome.status).toBe(expected)
  })

  it('throws a CloudError on an unexpected failure', async () => {
    const failure = await pollCloudLogin({
      ticket,
      fetchFn: responding(500, { error: 'server_error' }),
    }).catch((cause: unknown) => cause)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(500)
  })
})

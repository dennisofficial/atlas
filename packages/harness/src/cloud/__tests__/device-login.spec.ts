import { describe, expect, it } from 'bun:test'

import { CloudError } from '../cloud-client'
import {
  beginCloudLogin,
  ECloudLoginPoll,
  pollCloudLogin,
  type CloudLoginTicket,
} from '../device-login'

const URL = 'http://cloud.test'

const responding = (status: number, body?: unknown): typeof fetch =>
  (() =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    )) as unknown as typeof fetch

const ticket: CloudLoginTicket = {
  url: URL,
  deviceCode: 'dev_code_1',
  userCode: 'ABCD-EFGH',
  verificationUrl: 'http://cloud.test/device?user_code=ABCD-EFGH',
  expiresInMs: 300_000,
  intervalMs: 5_000,
}

describe('the cloud login adapter', () => {
  it('keeps a refused device login a CloudError with its status', async () => {
    const failure = await beginCloudLogin({
      url: URL,
      fetchFn: responding(500, { message: 'boom' }),
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(500)
    expect((failure as CloudError).message).toContain('refused a device login with 500')
  })

  it('keeps an unreachable host a CloudError with status 0', async () => {
    const down = (() => Promise.reject(new Error('connection refused'))) as unknown as typeof fetch

    const failure = await beginCloudLogin({ url: URL, fetchFn: down }).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(0)
  })

  it('keeps a failed poll a CloudError with its status', async () => {
    const failure = await pollCloudLogin({
      ticket,
      fetchFn: responding(500, { error: 'server_error' }),
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CloudError)
    expect((failure as CloudError).status).toBe(500)
  })

  it('passes a poll outcome through unchanged', async () => {
    const outcome = await pollCloudLogin({
      ticket,
      fetchFn: responding(400, { error: 'authorization_pending' }),
    })

    expect(outcome).toEqual({ status: ECloudLoginPoll.Pending })
  })
})

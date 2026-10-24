import { describe, expect, it } from 'bun:test'

import { createApiClient } from '@dltech/atlas-api-router'

import { cloudCall } from '../api-client'
import { UNREACHABLE } from '../auth-api'
import { CloudApiError } from '../cloud-api'

const fetchAnswering = (answer: () => Response | Promise<Response>): typeof fetch =>
  Object.assign(async () => answer(), { preconnect: fetch.preconnect })

const errorEnvelope = (args: {
  status: number
  message: string
  details?: Record<string, unknown>
}): Response =>
  Response.json(
    {
      error: {
        message: args.message,
        code: -32603,
        data: {
          code: 'INTERNAL_SERVER_ERROR',
          httpStatus: args.status,
          ...(args.details === undefined ? {} : { details: args.details }),
        },
      },
    },
    { status: args.status },
  )

const failureOf = async (fetchFn: typeof fetch): Promise<unknown> => {
  const client = createApiClient({ baseUrl: '', fetchFn })
  return cloudCall(client.sandboxSelf.stop.mutate({})).then(
    () => undefined,
    (failure: unknown) => failure,
  )
}

describe('cloudCall', () => {
  it('returns what the call resolves with', async () => {
    expect(await cloudCall(Promise.resolve({ ok: true }))).toEqual({ ok: true })
  })

  it('prefers the details message and carries status and code', async () => {
    const failure = await failureOf(
      fetchAnswering(() =>
        errorEnvelope({
          status: 409,
          message: 'generic',
          details: { message: 'This invitation is for someone else', code: 'WRONG_RECIPIENT' },
        }),
      ),
    )

    expect(failure).toBeInstanceOf(CloudApiError)
    expect(failure).toMatchObject({
      message: 'This invitation is for someone else',
      status: 409,
      code: 'WRONG_RECIPIENT',
    })
  })

  it('takes the first entry of a details message array', async () => {
    const failure = await failureOf(
      fetchAnswering(() =>
        errorEnvelope({
          status: 400,
          message: 'generic',
          details: { message: ['name must be longer', 'name is required'] },
        }),
      ),
    )

    expect(failure).toMatchObject({ message: 'name must be longer', status: 400 })
  })

  it('falls back to the error message without details, leaving code undefined', async () => {
    const failure = await failureOf(
      fetchAnswering(() => errorEnvelope({ status: 403, message: 'Forbidden' })),
    )

    expect(failure).toMatchObject({ message: 'Forbidden', status: 403, code: undefined })
  })

  it('falls back to Atlas Cloud answered <status> when no message exists', async () => {
    const failure = await failureOf(
      fetchAnswering(() => errorEnvelope({ status: 502, message: '' })),
    )

    expect(failure).toMatchObject({ message: 'Atlas Cloud answered 502', status: 502 })
  })

  it('maps a network failure to status 0 with the unreachable message', async () => {
    const failure = await failureOf(
      fetchAnswering(() => {
        throw new TypeError('network')
      }),
    )

    expect(failure).toBeInstanceOf(CloudApiError)
    expect(failure).toMatchObject({ message: UNREACHABLE, status: 0 })
  })
})

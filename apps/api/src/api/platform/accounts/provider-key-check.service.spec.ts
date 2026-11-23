import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'bun:test'

import { ProviderKeyCheckService, type ProviderKeyHttp } from './provider-key-check.service'

const httpOf = (args: { status: number; onCall?: () => void }): ProviderKeyHttp => ({
  fetch: (async () => {
    args.onCall?.()
    return new Response(null, { status: args.status })
  }) as unknown as typeof fetch,
})

const VALID_KEY = 'sk-aaaaaaaaaaaaaaaaaaaa'

describe('ProviderKeyCheckService', () => {
  it('resolves for a key the provider accepts', async () => {
    const service = new ProviderKeyCheckService(httpOf({ status: 200 }))

    await expect(service.check({ provider: 'openai', apiKey: VALID_KEY })).resolves.toBeUndefined()
  })

  it('refuses an unknown provider without calling it', async () => {
    let called = false
    const service = new ProviderKeyCheckService(
      httpOf({ status: 200, onCall: () => (called = true) }),
    )

    await expect(service.check({ provider: 'bogus', apiKey: VALID_KEY })).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(called).toBe(false)
  })

  it('refuses a key the provider rejects, with its copy', async () => {
    const service = new ProviderKeyCheckService(httpOf({ status: 401 }))

    await expect(service.check({ provider: 'openai', apiKey: VALID_KEY })).rejects.toThrow(
      'OpenAI refused this key (401).',
    )
  })

  it('refuses a malformed key without calling the provider', async () => {
    let called = false
    const service = new ProviderKeyCheckService(
      httpOf({ status: 200, onCall: () => (called = true) }),
    )

    await expect(service.check({ provider: 'openai', apiKey: 'short' })).rejects.toThrow(
      'This key is too short.',
    )
    expect(called).toBe(false)
  })
})

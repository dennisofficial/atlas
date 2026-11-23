import { describe, expect, it } from 'bun:test'

import { EAuthProvider, providerSpec } from '@dltech/atlas-core'

import { checkProviderKey, EKeyCheckFault, keyFormatFault } from '../key-check'

const KEY_LENGTH = 20

const validKeyOf = (provider: EAuthProvider): string => {
  const suffix = 'a'.repeat(KEY_LENGTH)
  if (provider === EAuthProvider.Anthropic) return `sk-ant-${suffix}`
  if (provider === EAuthProvider.OpenAI) return `sk-${suffix}`
  if (provider === EAuthProvider.OpenRouter) return `sk-or-${suffix}`
  return `key-${suffix}`
}

const PROVIDERS = Object.values(EAuthProvider)

const asFetch = (impl: () => Promise<Response>): typeof fetch => impl as unknown as typeof fetch

const answering = (status: number): typeof fetch =>
  asFetch(async () => new Response(null, { status }))

const failing: typeof fetch = asFetch(async () => {
  throw new Error('socket hang up')
})

describe('keyFormatFault', () => {
  it('accepts a well-formed key for every provider', () => {
    for (const provider of PROVIDERS)
      expect(keyFormatFault({ provider, apiKey: validKeyOf(provider) })).toBeUndefined()
  })

  it('refuses an empty key', () => {
    expect(keyFormatFault({ provider: EAuthProvider.OpenAI, apiKey: '   ' })).toBe(
      'This key is empty.',
    )
  })

  it('refuses a key with spaces inside it', () => {
    expect(
      keyFormatFault({ provider: EAuthProvider.Inference, apiKey: 'key with spaces and more' }),
    ).toBe('This key has spaces in it.')
  })

  it('refuses a key shorter than 20 characters', () => {
    expect(keyFormatFault({ provider: EAuthProvider.Gateway, apiKey: 'short-key' })).toBe(
      'This key is too short.',
    )
  })

  it.each([
    [EAuthProvider.Anthropic, 'sk-ant-'],
    [EAuthProvider.OpenAI, 'sk-'],
    [EAuthProvider.OpenRouter, 'sk-or-'],
  ])('refuses a %s key without its prefix', (provider, prefix) => {
    expect(keyFormatFault({ provider, apiKey: `wrong-prefix-${'a'.repeat(KEY_LENGTH)}` })).toBe(
      `An ${providerSpec(provider).label} key starts with ${prefix}.`,
    )
  })
})

describe('checkProviderKey probes', () => {
  const EXPECTED: Record<EAuthProvider, { url: string; header: string; value: string }> = {
    [EAuthProvider.Anthropic]: {
      url: 'https://api.anthropic.com/v1/models',
      header: 'x-api-key',
      value: '',
    },
    [EAuthProvider.OpenAI]: {
      url: 'https://api.openai.com/v1/models',
      header: 'authorization',
      value: '',
    },
    [EAuthProvider.OpenRouter]: {
      url: 'https://openrouter.ai/api/v1/key',
      header: 'authorization',
      value: '',
    },
    [EAuthProvider.Inference]: {
      url: 'https://api.inference.net/v1/models',
      header: 'authorization',
      value: '',
    },
    [EAuthProvider.Typesafe]: {
      url: 'https://api.typesafe.ai/v1/models',
      header: 'authorization',
      value: '',
    },
    [EAuthProvider.Gateway]: {
      url: 'https://ai-gateway.vercel.sh/v1/credits',
      header: 'authorization',
      value: '',
    },
  }

  for (const provider of PROVIDERS) {
    it(`reads ${provider} with its own URL and auth header`, async () => {
      const calls: { url: string; headers: Record<string, string> }[] = []
      const recording = ((input: unknown, init?: RequestInit) => {
        calls.push({
          url: String(input),
          headers: (init?.headers ?? {}) as Record<string, string>,
        })
        return Promise.resolve(new Response(null, { status: 200 }))
      }) as unknown as typeof fetch
      const apiKey = validKeyOf(provider)

      const result = await checkProviderKey({ provider, apiKey, fetch: recording })

      expect(result).toEqual({ ok: true })
      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).toBe(EXPECTED[provider].url)
      const expectedValue =
        EXPECTED[provider].header === 'authorization' ? `Bearer ${apiKey}` : apiKey
      expect(calls[0]?.headers[EXPECTED[provider].header]).toBe(expectedValue)
      if (provider === EAuthProvider.Anthropic)
        expect(calls[0]?.headers['anthropic-version']).toBe('2023-06-01')
    })
  }

  it('answers ok on 200', async () => {
    const result = await checkProviderKey({
      provider: EAuthProvider.OpenAI,
      apiKey: validKeyOf(EAuthProvider.OpenAI),
      fetch: answering(200),
    })
    expect(result).toEqual({ ok: true })
  })

  it('reports a refusal on 401 without calling the provider again', async () => {
    const result = await checkProviderKey({
      provider: EAuthProvider.OpenAI,
      apiKey: validKeyOf(EAuthProvider.OpenAI),
      fetch: answering(401),
    })
    expect(result).toEqual({
      ok: false,
      fault: EKeyCheckFault.Refused,
      detail: 'OpenAI refused this key (401).',
    })
  })

  it('reports unreachable on a server error', async () => {
    const result = await checkProviderKey({
      provider: EAuthProvider.Inference,
      apiKey: validKeyOf(EAuthProvider.Inference),
      fetch: answering(500),
    })
    expect(result).toEqual({
      ok: false,
      fault: EKeyCheckFault.Unreachable,
      detail: 'Atlas could not reach Inference.net to check this key (500). Try again.',
    })
  })

  it('reports unreachable when the fetch throws', async () => {
    const result = await checkProviderKey({
      provider: EAuthProvider.Gateway,
      apiKey: validKeyOf(EAuthProvider.Gateway),
      fetch: failing,
    })
    expect(result).toEqual({
      ok: false,
      fault: EKeyCheckFault.Unreachable,
      detail:
        'Atlas could not reach Vercel AI Gateway to check this key (socket hang up). Try again.',
    })
  })

  it('reports unreachable when the probe times out', async () => {
    const hanging = ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
      })) as unknown as typeof fetch

    const result = await checkProviderKey({
      provider: EAuthProvider.OpenRouter,
      apiKey: validKeyOf(EAuthProvider.OpenRouter),
      fetch: hanging,
      timeoutMs: 5,
    })
    expect(result).toEqual({
      ok: false,
      fault: EKeyCheckFault.Unreachable,
      detail: 'Atlas could not reach OpenRouter to check this key (timed out). Try again.',
    })
  })

  it('does not probe a key that fails the format check', async () => {
    let called = false
    const recording = asFetch(async () => {
      called = true
      return new Response(null, { status: 200 })
    })

    const result = await checkProviderKey({
      provider: EAuthProvider.Anthropic,
      apiKey: 'sk-ant-short',
      fetch: recording,
    })

    expect(result).toEqual({
      ok: false,
      fault: EKeyCheckFault.Format,
      detail: 'This key is too short.',
    })
    expect(called).toBe(false)
  })
})

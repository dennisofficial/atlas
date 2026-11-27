import { describe, expect, it } from 'bun:test'

import { EAuthProvider, EReturnResult } from '@dltech/atlas-core'

import {
  providerLoopbackCopyOf,
  providerLoopbackOf,
  providerReturnOf,
  startProviderLoopback,
} from '../account/provider-loopback'

const STATE = 'state-1'

const BEGIN = {
  attemptId: 'attempt-1',
  authorizeUrl: 'https://auth.example.test/authorize?state=state-1',
  state: STATE,
}

describe('the loopback a provider sign-in comes back on', () => {
  it('names the addresses each provider registers', () => {
    const claude = providerLoopbackOf(EAuthProvider.Anthropic)
    const codex = providerLoopbackOf(EAuthProvider.OpenAI)

    expect(claude?.ports).toEqual([0])
    expect(claude?.redirectUriOf(53682)).toBe('http://localhost:53682/callback')
    expect(codex?.ports).toEqual([1455, 1457])
    expect(codex?.redirectUriOf(1455)).toBe('http://127.0.0.1:1455/auth/callback')
    expect(providerLoopbackOf(EAuthProvider.OpenRouter)).toBeUndefined()
  })

  it('takes the code of its own state, and reports a refusal as a failed page', () => {
    expect(
      providerReturnOf({
        url: `http://localhost:53682/callback?code=code-1&state=${STATE}`,
        state: STATE,
      }),
    ).toEqual({ page: { result: EReturnResult.Connected }, value: { code: 'code-1' } })
    expect(
      providerReturnOf({
        url: `http://localhost:53682/callback?error=access_denied&state=${STATE}`,
        state: STATE,
      }),
    ).toEqual({
      page: { result: EReturnResult.Failed, reason: 'access_denied' },
      value: { error: 'access_denied' },
    })
    expect(
      providerReturnOf({
        url: 'http://localhost:53682/callback?code=code-1&state=state-2',
        state: STATE,
      }),
    ).toBeUndefined()
    expect(
      providerReturnOf({ url: 'http://localhost:53682/callback?state=state-1', state: STATE }),
    ).toBeUndefined()
    expect(providerReturnOf({ url: 'not a url', state: STATE })).toBeUndefined()
  })

  it('tells the browser which provider signed in', () => {
    const claude = providerLoopbackCopyOf({
      ports: [0],
      redirectUriOf: () => '',
      path: '/callback',
      label: 'Claude',
    })

    expect(claude.connected).toBe('Signed in to Claude.')
    expect(claude.failed('access_denied')).toBe('Sign-in to Claude failed: access_denied')
  })

  it('binds first, then begins the attempt on the bound port and opens its browser', async () => {
    const opened: string[] = []
    const loopback = await startProviderLoopback({
      provider: EAuthProvider.Anthropic,
      begin: async (args) => {
        opened.push(args.redirectUri)
        return BEGIN
      },
      open: (url) => void opened.push(url),
    })

    try {
      expect(opened[0]).toBe(`http://localhost:${loopback.port}/callback`)
      expect(opened[1]).toBe(BEGIN.authorizeUrl)

      const answer = await fetch(
        `http://127.0.0.1:${loopback.port}/callback?code=the-code&state=${STATE}`,
      )
      expect(await answer.text()).toContain('Signed in to Claude.')

      expect(await loopback.done).toEqual({ attemptId: 'attempt-1', code: 'the-code' })
    } finally {
      loopback.stop()
    }
  })

  it('ignores a request of another state, and reports a refusal with no code', async () => {
    const loopback = await startProviderLoopback({
      provider: EAuthProvider.Anthropic,
      begin: async () => BEGIN,
      open: () => undefined,
    })

    try {
      const wrong = await fetch(
        `http://localhost:${loopback.port}/callback?code=the-code&state=state-2`,
      )
      expect(wrong.status).toBe(404)

      const refused = await fetch(
        `http://localhost:${loopback.port}/callback?error=access_denied&state=${STATE}`,
      )
      expect(await refused.text()).toContain('Sign-in to Claude failed: access_denied')
      expect(await loopback.done).toBeUndefined()
    } finally {
      loopback.stop()
    }
  })

  it('takes a later port when the first registered one is taken', async () => {
    const busy = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('busy') })

    try {
      const loopback = await startProviderLoopback({
        provider: EAuthProvider.OpenAI,
        begin: async () => BEGIN,
        open: () => undefined,
        ports: [busy.port as number, 0],
      })

      try {
        expect(loopback.port).not.toBe(busy.port as number)
        expect(loopback.redirectUri).toBe(`http://127.0.0.1:${loopback.port}/auth/callback`)
      } finally {
        loopback.stop()
      }
    } finally {
      busy.stop()
    }
  })

  it('stops waiting when the surface ends the sign-in', async () => {
    const loopback = await startProviderLoopback({
      provider: EAuthProvider.Anthropic,
      begin: async () => BEGIN,
      open: () => undefined,
    })

    loopback.stop()

    expect(await loopback.done).toBeUndefined()
  })

  it('reports a refused begin instead of waiting on a port nobody was told about', async () => {
    const failure = await startProviderLoopback({
      provider: EAuthProvider.Anthropic,
      begin: async () => {
        throw new Error('the api refused the address')
      },
      open: () => undefined,
    })
      .then(() => null)
      .catch((error: unknown) => error)

    expect(String(failure)).toContain('the api refused the address')
  })

  it('closes its port and opens no browser when cancelled while the attempt begins', async () => {
    const cancel = new AbortController()
    const opened: string[] = []
    const ports: number[] = []
    let release: (begun: typeof BEGIN) => void = () => undefined
    const starting = startProviderLoopback({
      provider: EAuthProvider.Anthropic,
      begin: ({ redirectUri }) => {
        ports.push(Number(new URL(redirectUri).port))
        return new Promise((resolve) => {
          release = resolve
        })
      },
      open: (url) => opened.push(url),
      signal: cancel.signal,
    })
      .then(() => null)
      .catch((error: unknown) => error)

    await Bun.sleep(0)
    cancel.abort()
    const refused = await fetch(`http://127.0.0.1:${ports[0]}/callback`).then(
      () => false,
      () => true,
    )
    release(BEGIN)

    expect(refused).toBe(true)
    expect(String(await starting)).toContain('cancelled')
    expect(opened).toEqual([])
  })
})

import { describe, expect, it } from 'bun:test'

import { loopbackRequestOk } from '../../browser-return/loopback'
import {
  ANTHROPIC_LOOPBACK_PATH,
  OPENAI_LOOPBACK_PATH,
  OPENAI_LOOPBACK_PORTS,
  PROVIDER_LOOPBACK_HOSTS,
  anthropicLoopbackRedirectOk,
  anthropicLoopbackRedirectUriOf,
  openaiLoopbackRedirectOk,
  openaiLoopbackRedirectUriOf,
} from '../provider-loopback'

describe('a provider loopback redirect', () => {
  it('names the addresses the public CLI clients register', () => {
    expect(OPENAI_LOOPBACK_PORTS).toEqual([1455, 1457])
    expect(OPENAI_LOOPBACK_PATH).toBe('/auth/callback')
    expect(ANTHROPIC_LOOPBACK_PATH).toBe('/callback')
    expect(PROVIDER_LOOPBACK_HOSTS).toEqual(['127.0.0.1', 'localhost'])
    expect(openaiLoopbackRedirectUriOf(1455)).toBe('http://127.0.0.1:1455/auth/callback')
    expect(anthropicLoopbackRedirectUriOf(53682)).toBe('http://localhost:53682/callback')
  })

  it('accepts only the Codex host and its two registered ports', () => {
    expect(openaiLoopbackRedirectOk('http://127.0.0.1:1455/auth/callback')).toBe(true)
    expect(openaiLoopbackRedirectOk('http://127.0.0.1:1457/auth/callback')).toBe(true)
    expect(openaiLoopbackRedirectOk('http://127.0.0.1:1456/auth/callback')).toBe(false)
    expect(openaiLoopbackRedirectOk('http://localhost:1455/auth/callback')).toBe(false)
    expect(openaiLoopbackRedirectOk('http://127.0.0.1:1455/callback')).toBe(false)
    expect(openaiLoopbackRedirectOk('https://127.0.0.1:1455/auth/callback')).toBe(false)
    expect(openaiLoopbackRedirectOk('http://127.0.0.1:1455/auth/callback?x=1')).toBe(false)
    expect(openaiLoopbackRedirectOk('https://example.test/auth/callback')).toBe(false)
    expect(openaiLoopbackRedirectOk('not a url')).toBe(false)
  })

  it('accepts only localhost on an unprivileged port for Claude', () => {
    expect(anthropicLoopbackRedirectOk('http://localhost:53682/callback')).toBe(true)
    expect(anthropicLoopbackRedirectOk('http://localhost:1024/callback')).toBe(true)
    expect(anthropicLoopbackRedirectOk('http://localhost:65535/callback')).toBe(true)
    expect(anthropicLoopbackRedirectOk('http://localhost:1023/callback')).toBe(false)
    expect(anthropicLoopbackRedirectOk('http://127.0.0.1:53682/callback')).toBe(false)
    expect(anthropicLoopbackRedirectOk('http://localhost:53682/auth/callback')).toBe(false)
    expect(anthropicLoopbackRedirectOk('http://localhost:53682/callback#x')).toBe(false)
    expect(anthropicLoopbackRedirectOk('https://localhost:53682/callback')).toBe(false)
  })

  it('lets a listener accept the host the provider was told to call', () => {
    const request = {
      method: 'GET',
      address: '127.0.0.1',
      url: 'http://localhost:53682/callback?code=code-1&state=state-1',
      port: 53682,
      path: ANTHROPIC_LOOPBACK_PATH,
    }

    expect(loopbackRequestOk({ ...request, hosts: PROVIDER_LOOPBACK_HOSTS })).toBe(true)
    expect(loopbackRequestOk(request)).toBe(false)
    expect(loopbackRequestOk({ ...request, hosts: PROVIDER_LOOPBACK_HOSTS, port: 1455 })).toBe(
      false,
    )
  })
})

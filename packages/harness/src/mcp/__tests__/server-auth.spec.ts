import { describe, expect, it } from 'bun:test'

import { ServerAuth } from '../bridge/server-auth'

describe('ServerAuth', () => {
  it('hands the token that drew a 401 back to the source and keeps the challenge', async () => {
    const rejected: { serverUrl: string; token: string }[] = []
    let n = 0
    const auth = new ServerAuth({
      serverUrl: 'https://x.example.com/mcp',
      source: {
        currentToken: async () => `t${++n}`,
        reject: (args) => void rejected.push(args),
      },
    })

    expect(await auth.bearerToken()).toBe('t1')
    auth.onUnauthorized({ wwwAuthenticate: 'Bearer realm="x"' })

    expect(rejected).toEqual([{ serverUrl: 'https://x.example.com/mcp', token: 't1' }])
    expect(auth.lastChallenge()).toBe('Bearer realm="x"')
  })

  it('has nothing to reject when no token was handed out', async () => {
    const rejected: unknown[] = []
    const auth = new ServerAuth({
      serverUrl: 'https://x.example.com/mcp',
      source: { currentToken: async () => undefined, reject: (args) => void rejected.push(args) },
    })

    await auth.bearerToken()
    auth.onUnauthorized({ wwwAuthenticate: undefined })

    expect(rejected).toEqual([])
  })
})

import { afterEach, describe, expect, it } from 'bun:test'

import { OAuthCallbackServer } from '../callback-server'

const servers: OAuthCallbackServer[] = []
const make = (): OAuthCallbackServer => {
  const server = new OAuthCallbackServer()
  servers.push(server)
  return server
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
})

const callbackUrl = (port: number, query: string): string =>
  `http://127.0.0.1:${port}/callback?${query}`

describe('OAuthCallbackServer', () => {
  it('resolves the code for a matching state', async () => {
    const server = make()
    const port = await server.ensureRunning()
    const waiting = server.waitForCallback('state-abc')

    const response = await fetch(callbackUrl(port, 'code=authcode123&state=state-abc'))
    expect(response.status).toBe(200)
    expect(await waiting).toBe('authcode123')
  })

  it('rejects a callback whose state was never registered', async () => {
    const server = make()
    const port = await server.ensureRunning()

    const response = await fetch(callbackUrl(port, 'code=x&state=unknown'))
    expect(response.status).toBe(400)
  })

  it('rejects the pending flow when the authorization server returns an error', async () => {
    const server = make()
    const port = await server.ensureRunning()
    // expect().rejects hangs under bun test when the rejection originates in a Bun.serve handler;
    // settle the promise manually instead.
    const waiting = server.waitForCallback('state-err').then(
      () => 'resolved',
      (error: Error) => error.message,
    )

    await fetch(callbackUrl(port, 'error=access_denied&error_description=nope&state=state-err'))
    expect(await waiting).toContain('refused the sign-in')
  })

  it('correlates concurrent flows by state', async () => {
    const server = make()
    const port = await server.ensureRunning()
    const first = server.waitForCallback('state-one')
    const second = server.waitForCallback('state-two')

    await fetch(callbackUrl(port, 'code=code-two&state=state-two'))
    await fetch(callbackUrl(port, 'code=code-one&state=state-one'))

    expect(await first).toBe('code-one')
    expect(await second).toBe('code-two')
  })

  it('answers 404 off the callback path', async () => {
    const server = make()
    const port = await server.ensureRunning()

    const response = await fetch(`http://127.0.0.1:${port}/elsewhere`)
    expect(response.status).toBe(404)
  })
})

import { afterEach, describe, expect, it } from 'bun:test'

import { AnthropicLoopbackServer } from '../anthropic-loopback'

const servers: AnthropicLoopbackServer[] = []
const occupants: ReturnType<typeof Bun.serve>[] = []

const newServer = (args: { timeoutMs?: number } = {}): AnthropicLoopbackServer => {
  const server = new AnthropicLoopbackServer(args)
  servers.push(server)
  return server
}

const occupy = (port: number): void => {
  occupants.push(Bun.serve({ hostname: '127.0.0.1', port, fetch: () => new Response('taken') }))
}

const refused = (url: string): Promise<boolean> =>
  fetch(url).then(
    () => false,
    () => true,
  )

const settled = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  )

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  await Promise.all(occupants.splice(0).map((occupant) => occupant.stop(true)))
})

describe('AnthropicLoopbackServer', () => {
  it('binds 53692 and spells the redirect uri with localhost', async () => {
    const bound = await newServer().listen()

    expect(bound).toEqual({ port: 53692, redirectUri: 'http://localhost:53692/callback' })
  })

  it('falls back to the next candidate when 53692 is occupied', async () => {
    occupy(53692)

    const bound = await newServer().listen()

    expect(bound).toEqual({ port: 53693, redirectUri: 'http://localhost:53693/callback' })
  })

  it('names the candidates when none can be bound', async () => {
    for (const port of [53692, 53693, 53694, 1455, 1457, 8085, 8976]) occupy(port)

    const failure = await settled(newServer().listen())

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('53692')
    expect((failure as Error).message).toContain('8976')
  })

  it('redirects the callback to /success, serves that page, then closes the port', async () => {
    const server = newServer()
    const { redirectUri, port } = await server.listen()
    const callback = server.waitForCallback({ state: 'state-1' })

    const redirect = await fetch(`${redirectUri}?code=the-code&state=state-1`, { redirect: 'manual' })

    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('location')).toBe(`http://localhost:${port}/success`)
    expect(await callback).toEqual({ code: 'the-code' })

    const success = await fetch(`http://localhost:${port}/success`)
    expect(success.status).toBe(200)
    expect(await success.text()).toContain('Signed in to Claude')

    await Bun.sleep(50)
    expect(await refused(`http://localhost:${port}/success`)).toBe(true)
  })

  it('still serves /success when the exchange finishes and closes the server first', async () => {
    const server = newServer()
    const { redirectUri, port } = await server.listen()
    const callback = server.waitForCallback({ state: 'state-1' })

    await fetch(`${redirectUri}?code=the-code&state=state-1`, { redirect: 'manual' })
    await callback
    await server.close()

    const success = await fetch(`http://localhost:${port}/success`)
    expect(await success.text()).toContain('Signed in to Claude')
  })

  it('rejects and renders an error page on a state mismatch', async () => {
    const server = newServer()
    const { redirectUri } = await server.listen()
    const callback = settled(server.waitForCallback({ state: 'state-1' }))

    const page = await fetch(`${redirectUri}?code=the-code&state=forged`)

    expect(page.status).toBe(400)
    expect(await page.text()).toContain('Sign-in failed')
    expect(((await callback) as Error).message).toContain('state')
  })

  it('rejects with the authorization server detail on an error param', async () => {
    const server = newServer()
    const { redirectUri } = await server.listen()
    const callback = settled(server.waitForCallback({ state: 'state-1' }))

    const page = await fetch(
      `${redirectUri}?error=access_denied&error_description=user%20said%20no&state=state-1`,
    )

    expect(await page.text()).toContain('user said no')
    expect(((await callback) as Error).message).toContain('user said no')
  })

  it('rejects a callback that carries no code', async () => {
    const server = newServer()
    const { redirectUri } = await server.listen()
    const callback = settled(server.waitForCallback({ state: 'state-1' }))

    const page = await fetch(`${redirectUri}?state=state-1`)

    expect(page.status).toBe(400)
    expect(((await callback) as Error).message).toContain('no authorization code')
  })

  it('answers unknown paths with 404', async () => {
    const { port } = await newServer().listen()

    expect((await fetch(`http://localhost:${port}/nope`)).status).toBe(404)
  })

  it('rejects when nobody calls back in time', async () => {
    const server = newServer({ timeoutMs: 20 })
    await server.listen()

    const failure = await settled(server.waitForCallback({ state: 'state-1' }))

    expect((failure as Error).message).toContain('five minutes')
  })

  it('rejects a pending wait when closed', async () => {
    const server = newServer()
    const { redirectUri } = await server.listen()
    const callback = settled(server.waitForCallback({ state: 'state-1' }))

    await server.close()

    expect(((await callback) as Error).message).toContain('closed')
    expect(await refused(`${redirectUri}?code=c&state=state-1`)).toBe(true)
  })
})

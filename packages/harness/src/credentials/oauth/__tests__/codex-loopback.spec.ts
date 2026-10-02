import { afterEach, describe, expect, it } from 'bun:test'

import { CodexLoopbackServer } from '../codex-loopback'

const servers: CodexLoopbackServer[] = []
const occupants: ReturnType<typeof Bun.serve>[] = []

const newServer = (args: { timeoutMs?: number } = {}): CodexLoopbackServer => {
  const server = new CodexLoopbackServer(args)
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

describe('CodexLoopbackServer', () => {
  it('binds the codex port and reports the matching redirect uri', async () => {
    const bound = await newServer().listen()

    expect(bound).toEqual({ port: 1455, redirectUri: 'http://127.0.0.1:1455/auth/callback' })
  })

  it('falls back to 1457 when 1455 is occupied', async () => {
    occupy(1455)

    const bound = await newServer().listen()

    expect(bound).toEqual({ port: 1457, redirectUri: 'http://127.0.0.1:1457/auth/callback' })
  })

  it('names both ports when neither can be bound', async () => {
    occupy(1455)
    occupy(1457)

    const failure = await settled(newServer().listen())

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('1455')
    expect((failure as Error).message).toContain('1457')
  })

  it('redirects the callback to /success, serves that page, then closes the port', async () => {
    const server = newServer()
    const { redirectUri } = await server.listen()
    const callback = server.waitForCallback({ state: 'state-1' })

    const redirect = await fetch(`${redirectUri}?code=the-code&state=state-1`, { redirect: 'manual' })

    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('location')).toBe('http://127.0.0.1:1455/success')
    expect(await callback).toEqual({ code: 'the-code' })

    const success = await fetch('http://127.0.0.1:1455/success')
    expect(success.status).toBe(200)
    expect(await success.text()).toContain('Signed in with ChatGPT')

    await Bun.sleep(50)
    expect(await refused('http://127.0.0.1:1455/success')).toBe(true)
  })

  it('still serves /success when the exchange finishes and closes the server first', async () => {
    const server = newServer()
    const { redirectUri } = await server.listen()
    const callback = server.waitForCallback({ state: 'state-1' })

    await fetch(`${redirectUri}?code=the-code&state=state-1`, { redirect: 'manual' })
    await callback
    await server.close()

    const success = await fetch('http://127.0.0.1:1455/success')
    expect(await success.text()).toContain('Signed in with ChatGPT')
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
    await newServer().listen()

    expect((await fetch('http://127.0.0.1:1455/nope')).status).toBe(404)
  })

  it('rejects when nobody calls back in time', async () => {
    const server = newServer({ timeoutMs: 20 })
    await server.listen()

    const failure = await settled(server.waitForCallback({ state: 'state-1' }))

    expect((failure as Error).message).toContain('five minutes')
  })

  it('rejects a pending wait when closed', async () => {
    const server = newServer()
    await server.listen()
    const callback = settled(server.waitForCallback({ state: 'state-1' }))

    await server.close()

    expect(((await callback) as Error).message).toContain('closed')
    expect(await refused('http://127.0.0.1:1455/nope')).toBe(true)
  })
})

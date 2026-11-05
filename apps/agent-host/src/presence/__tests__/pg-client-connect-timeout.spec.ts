import { afterEach, describe, expect, it } from 'bun:test'

import { createPgHostPresence, PRESENCE_CONNECT_TIMEOUT_MS } from '../pg-host-presence'

type Silent = { port: number; stop(): void }

const startSilentServer = (): Silent => {
  const server = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: { open: () => undefined, data: () => undefined },
  })
  return { port: server.port, stop: () => server.stop(true) }
}

describe('presence connect timeout', () => {
  const servers: Silent[] = []

  afterEach(() => {
    for (const server of servers.splice(0)) server.stop()
  })

  it('register rejects instead of hanging when the server accepts but never answers', async () => {
    const server = startSilentServer()
    servers.push(server)
    const presence = createPgHostPresence({
      url: `postgres://u:p@127.0.0.1:${server.port}/db`,
      label: 'silent',
    })
    const startedAt = Date.now()
    await expect(presence.register()).rejects.toThrow()
    expect(Date.now() - startedAt).toBeLessThan(PRESENCE_CONNECT_TIMEOUT_MS + 3_000)
  }, 20_000)
})

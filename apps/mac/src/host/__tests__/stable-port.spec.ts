import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { HOST_PORT_FILE, readHostPort, startOnStablePort } from '../stable-port'

const servers: ReturnType<typeof Bun.serve>[] = []

const serve = (port: number) => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch: () => new Response('ok'),
  })
  servers.push(server)
  return { port: server.port as number }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)))
})

const freshHome = () => mkdtempSync(join(tmpdir(), 'atlas-port-'))

describe('startOnStablePort', () => {
  test('remembers the first port and binds it again on the next launch', async () => {
    const home = freshHome()
    const first = startOnStablePort({ home, start: serve })
    expect(readHostPort(home)).toBe(first.port)
    await servers.splice(0)[0]?.stop(true)
    const second = startOnStablePort({ home, start: serve })
    expect(second.port).toBe(first.port)
  })

  test('falls back to a free port and remembers it when the old one is taken', () => {
    const home = freshHome()
    const squatter = serve(0)
    writeFileSync(join(home, HOST_PORT_FILE), String(squatter.port))
    const started = startOnStablePort({ home, start: serve })
    expect(started.port).not.toBe(squatter.port)
    expect(readFileSync(join(home, HOST_PORT_FILE), 'utf8')).toBe(String(started.port))
  })

  test('ignores a corrupt port file', () => {
    const home = freshHome()
    writeFileSync(join(home, HOST_PORT_FILE), 'not-a-port')
    expect(readHostPort(home)).toBeUndefined()
    const started = startOnStablePort({ home, start: serve })
    expect(readHostPort(home)).toBe(started.port)
  })
})

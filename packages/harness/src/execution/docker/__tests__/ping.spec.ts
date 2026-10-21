import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { pingDocker } from '../ping'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function serveAt(respond: () => Response | Promise<Response>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-ping-'))
  const socketPath = join(directory, 'docker.sock')
  const server = Bun.serve({ unix: socketPath, fetch: respond })
  cleanups.push(async () => {
    await server.stop(true)
    await rm(directory, { recursive: true, force: true })
  })
  return socketPath
}

describe('pingDocker', () => {
  it('answers undefined when the daemon says OK', async () => {
    const socketPath = await serveAt(() => new Response('OK\n'))
    expect(await pingDocker({ socketPath })).toBeUndefined()
  })

  it('asks GET /_ping', async () => {
    const seen: string[] = []
    const socketPath = await serveAt((): Response => {
      seen.push('hit')
      return new Response('OK')
    })
    await pingDocker({ socketPath })
    expect(seen).toEqual(['hit'])
  })

  it('names the HTTP status when the daemon answers an error', async () => {
    const socketPath = await serveAt(() => new Response('boom', { status: 500 }))
    expect(await pingDocker({ socketPath })).toBe('Docker answered _ping with HTTP 500')
  })

  it('reports an unexpected body as a failure', async () => {
    const socketPath = await serveAt(() => new Response('hello'))
    expect(await pingDocker({ socketPath })).toContain('unexpected body')
  })

  it('reports a missing socket without throwing', async () => {
    const reason = await pingDocker({ socketPath: join(tmpdir(), 'atlas-ping-missing', 'docker.sock') })
    expect(typeof reason).toBe('string')
    expect(reason).not.toBe('')
  })

  it('gives up on a daemon that never answers', async () => {
    const socketPath = await serveAt(() => new Promise<Response>(() => undefined))
    const reason = await pingDocker({ socketPath, timeoutMs: 50 })
    expect(typeof reason).toBe('string')
  })
})

import { describe, expect, test } from 'bun:test'

import { startAppServer, type TStartServer } from '../app-server'

function fakeStart({ failFor }: { failFor?: string } = {}) {
  const calls: string[] = []
  const start: TStartServer = async ({ root }) => {
    calls.push(`start:${root}`)
    if (root === failFor) throw new Error(`no server at ${root}`)
    return { origin: `http://origin${root}`, stop: async () => void calls.push(`stop:${root}`) }
  }
  return { start, calls }
}

describe('startAppServer', () => {
  test('serves the requested root and reports its origin', async () => {
    const fake = fakeStart()
    const server = await startAppServer({
      root: '/payload',
      fallback: '/bundled',
      bunPath: 'bun',
      start: fake.start,
    })
    expect(server.origin()).toBe('http://origin/payload')
    expect(server.usedFallback()).toBe(false)
    expect(fake.calls).toEqual(['start:/payload'])
  })

  test('falls back to the bundled root when the payload cannot start', async () => {
    const fake = fakeStart({ failFor: '/payload' })
    const server = await startAppServer({
      root: '/payload',
      fallback: '/bundled',
      bunPath: 'bun',
      start: fake.start,
    })
    expect(server.origin()).toBe('http://origin/bundled')
    expect(server.usedFallback()).toBe(true)
    expect(fake.calls).toEqual(['start:/payload', 'start:/bundled'])
  })

  test('swaps in the new server before stopping the old one', async () => {
    const fake = fakeStart()
    const server = await startAppServer({
      root: '/bundled',
      fallback: '/bundled',
      bunPath: 'bun',
      start: fake.start,
    })
    const result = await server.restart({ root: '/next', fallback: '/bundled' })
    expect(result).toEqual({ usedFallback: false })
    expect(server.origin()).toBe('http://origin/next')
    expect(fake.calls).toEqual(['start:/bundled', 'start:/next', 'stop:/bundled'])
  })

  test('keeps serving the old root when neither root starts', async () => {
    const calls: string[] = []
    let served = 0
    const start: TStartServer = async ({ root }) => {
      calls.push(`start:${root}`)
      served += 1
      if (served > 1) throw new Error(`no server at ${root}`)
      return { origin: `http://origin${root}`, stop: async () => void calls.push(`stop:${root}`) }
    }
    const server = await startAppServer({
      root: '/bundled',
      fallback: '/bundled',
      bunPath: 'bun',
      start,
    })
    await expect(server.restart({ root: '/next', fallback: '/bundled' })).rejects.toThrow()
    expect(server.origin()).toBe('http://origin/bundled')
    expect(calls).toEqual(['start:/bundled', 'start:/next', 'start:/bundled'])
  })

  test('reports a fallback restart so the caller can retire the payload', async () => {
    const fake = fakeStart({ failFor: '/next' })
    const server = await startAppServer({
      root: '/bundled',
      fallback: '/bundled',
      bunPath: 'bun',
      start: fake.start,
    })
    const result = await server.restart({ root: '/next', fallback: '/bundled' })
    expect(result).toEqual({ usedFallback: true })
    expect(server.origin()).toBe('http://origin/bundled')
  })
})

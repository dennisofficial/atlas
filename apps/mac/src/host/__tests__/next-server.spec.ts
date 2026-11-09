import { describe, expect, test } from 'bun:test'

import { bunPathOf, startNextServer, type INextServer, type INextServerPorts } from '../next-server'

function fakePorts({
  readyOnProbe = 1,
  exitsEarly = false,
}: {
  readyOnProbe?: number
  exitsEarly?: boolean
} = {}) {
  const calls: string[] = []
  let probes = 0
  let killed = false
  let clock = 0
  let die: (code: number) => void = () => undefined
  const exited = new Promise<number>((resolve) => {
    die = resolve
  })
  const ports: INextServerPorts = {
    freePort: async () => 4321,
    spawn: () => {
      calls.push('spawn')
      if (exitsEarly) die(1)
      return {
        kill: () => {
          killed = true
          calls.push('kill')
          die(0)
        },
        exited,
        output: () => 'server.js exited with 1',
      }
    },
    ready: async (origin) => {
      probes += 1
      calls.push(`ready:${origin}`)
      return probes >= readyOnProbe
    },
    sleep: async (ms) => {
      clock += ms
    },
    now: () => clock,
  }
  return { ports, calls, killed: () => killed, probes: () => probes }
}

describe('startNextServer', () => {
  test('returns the origin once the app server answers', async () => {
    const fake = fakePorts({ readyOnProbe: 2 })
    const server: INextServer = await startNextServer({
      root: '/app',
      bunPath: '/bin/bun',
      ports: fake.ports,
    })
    expect(server.origin).toBe('http://127.0.0.1:4321')
    expect(fake.probes()).toBe(2)
    expect(fake.calls[0]).toBe('spawn')
    await server.stop()
    expect(fake.killed()).toBe(true)
  })

  test('reports the child output when the server dies before listening', async () => {
    const fake = fakePorts({ readyOnProbe: 99, exitsEarly: true })
    const failure = startNextServer({ root: '/app', bunPath: '/bin/bun', ports: fake.ports })
    await expect(failure).rejects.toThrow('server.js exited with 1')
    expect(fake.killed()).toBe(false)
  })

  test('gives up on the deadline and kills the server', async () => {
    const fake = fakePorts({ readyOnProbe: 99 })
    const failure = startNextServer({
      root: '/app',
      bunPath: '/bin/bun',
      ports: fake.ports,
      timeoutMs: 250,
    })
    await expect(failure).rejects.toThrow('did not answer')
    expect(fake.killed()).toBe(true)
  })
})

describe('bunPathOf', () => {
  test('prefers the bun on PATH', () => {
    expect(
      bunPathOf({ onPath: '/opt/bun/bin/bun', execPath: '/Applications/Atlas.app/Atlas' }),
    ).toBe('/opt/bun/bin/bun')
  })

  test('accepts a runtime that is itself bun', () => {
    expect(bunPathOf({ onPath: null, execPath: '/usr/local/bin/bun' })).toBe('/usr/local/bin/bun')
  })

  test('refuses to spawn the app launcher', () => {
    expect(() => bunPathOf({ onPath: null, execPath: '/Applications/Atlas.app/Atlas' })).toThrow(
      'no bun executable',
    )
  })
})

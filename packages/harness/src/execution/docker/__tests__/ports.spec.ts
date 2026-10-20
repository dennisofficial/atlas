import { describe, expect, it } from 'bun:test'

import { derivedHostPort, hostPortFor } from '../ports'

const WORKTREE = '/Users/operator/Developer/project/.atlas/worktrees/feature'
const CONTAINER_PORT = 8080

describe('derivedHostPort', () => {
  it('is a pure function of the session key and the container port', () => {
    const first = derivedHostPort({ session: WORKTREE, containerPort: 3000 })

    expect(first).toBe(derivedHostPort({ session: WORKTREE, containerPort: 3000 }))
    expect(first).toBeGreaterThanOrEqual(20_000)
    expect(first).toBeLessThan(49_152)
  })

  it('gives two sessions different host ports for the same container port', () => {
    const one = derivedHostPort({ session: '/work/one', containerPort: 3000 })
    const two = derivedHostPort({ session: '/work/two', containerPort: 3000 })

    expect(one).not.toBe(two)
  })
})

describe('hostPortFor', () => {
  it('uses the derived host port while it is free', () => {
    expect(hostPortFor({ session: WORKTREE, containerPort: CONTAINER_PORT })).toBe(
      derivedHostPort({ session: WORKTREE, containerPort: CONTAINER_PORT }),
    )
  })

  it('falls back to an ephemeral host port when the derived one is taken', () => {
    const session = '/work/taken-fallback'
    const derived = derivedHostPort({ session, containerPort: CONTAINER_PORT })
    const occupant = Bun.listen({
      hostname: '127.0.0.1',
      port: derived,
      socket: { data() {} },
    })

    try {
      const hostPort = hostPortFor({ session, containerPort: CONTAINER_PORT })

      expect(hostPort).not.toBe(derived)

      const probe = Bun.listen({ hostname: '127.0.0.1', port: hostPort, socket: { data() {} } })
      probe.stop(true)
    } finally {
      occupant.stop(true)
    }
  })
})

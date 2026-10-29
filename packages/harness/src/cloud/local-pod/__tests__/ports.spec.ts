import { describe, expect, it } from 'bun:test'

import { derivedHostPort } from '../ports'

describe('derivedHostPort', () => {
  it('is stable for a session and container port and stays below the ephemeral range', () => {
    const port = derivedHostPort({ session: 'pod-ports', containerPort: 3000 })

    expect(port).toBe(derivedHostPort({ session: 'pod-ports', containerPort: 3000 }))
    expect(port).toBeGreaterThanOrEqual(20_000)
    expect(port).toBeLessThan(49_152)
  })
})

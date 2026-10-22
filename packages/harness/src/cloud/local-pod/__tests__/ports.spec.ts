import { describe, expect, it } from 'bun:test'

import { derivedHostPort, podHostPortsFor } from '../ports'

const COLLIDING_SESSION = 'pod-live-0-00001907'

describe('podHostPortsFor', () => {
  it('never hands serve and ingress the same host port when their derived ports collide', () => {
    expect(derivedHostPort({ session: COLLIDING_SESSION, containerPort: 3000 })).toBe(
      derivedHostPort({ session: COLLIDING_SESSION, containerPort: 7676 }),
    )

    const ports = podHostPortsFor({
      session: COLLIDING_SESSION,
      serveContainerPort: 3000,
      ingressContainerPort: 7676,
    })

    expect(ports.ingressHostPort).not.toBe(ports.serveHostPort)
  })

  it('keeps the derived ports when they are distinct and free', () => {
    const session = 'pod-ports-distinct'
    const ports = podHostPortsFor({ session, serveContainerPort: 3000, ingressContainerPort: 7676 })

    expect(ports.serveHostPort).not.toBe(ports.ingressHostPort)
  })
})

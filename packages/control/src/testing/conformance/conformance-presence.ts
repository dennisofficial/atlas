import { beforeEach, describe, expect, it } from 'bun:test'

import { makeHarness, type Harness } from './support'
import type { ConformanceParams } from './conformance'

export type PresenceParams = ConformanceParams & {
  holdShared: (hostId: number) => Promise<() => Promise<void>>
}

export function describeControlPlanePresence(params: PresenceParams): void {
  describe(`ControlPlane presence (${params.name})`, () => {
    let harness: Harness

    beforeEach(async () => {
      await params.reset()
      harness = makeHarness(params.makeStore())
    })

    it('a host is absent by default', async () => {
      const hostId = await params.nextHostId()
      expect(await harness.plane.hostPresent({ hostId })).toBe(false)
    })

    it('a host is present while its lock is held', async () => {
      const hostId = await params.nextHostId()
      const release = await params.holdPresence(hostId)
      try {
        expect(await harness.plane.hostPresent({ hostId })).toBe(true)
      } finally {
        await release()
      }
    })

    it('a host is absent after its lock is released', async () => {
      const hostId = await params.nextHostId()
      const release = await params.holdPresence(hostId)
      await release()
      expect(await harness.plane.hostPresent({ hostId })).toBe(false)
    })

    it('presence is per host', async () => {
      const held = await params.nextHostId()
      const other = await params.nextHostId()
      const release = await params.holdPresence(held)
      try {
        expect(await harness.plane.hostPresent({ hostId: other })).toBe(false)
      } finally {
        await release()
      }
    })

    it('a shared hold alone is not present', async () => {
      const hostId = await params.nextHostId()
      const release = await params.holdShared(hostId)
      try {
        expect(await harness.plane.hostPresent({ hostId })).toBe(false)
      } finally {
        await release()
      }
    })
  })
}

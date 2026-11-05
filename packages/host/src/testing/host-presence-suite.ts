import { afterEach, describe, expect, it } from 'bun:test'

import type { ControlPlane } from '@dltech/atlas-control'

import type { HostPresence } from '../holder/ports'

export type HostPresenceHandle = {
  presence: HostPresence
  plane: ControlPlane
  lose(): Promise<void>
  dispose?: (() => Promise<void>) | undefined
}

export type HostPresenceTarget = { name: string; make: () => HostPresenceHandle }

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100))

export function describeHostPresence(target: HostPresenceTarget): void {
  describe(`HostPresence (${target.name})`, () => {
    const handles: HostPresenceHandle[] = []

    const open = (): HostPresenceHandle => {
      const handle = target.make()
      handles.push(handle)
      return handle
    }

    afterEach(async () => {
      for (const handle of handles.splice(0)) {
        await handle.presence.close()
        await handle.dispose?.()
      }
    })

    it('a registered host is present to the control plane', async () => {
      const { presence, plane } = open()
      const hostId = await presence.register()
      expect(await plane.hostPresent({ hostId })).toBe(true)
    })

    it('two registrations get distinct ids', async () => {
      const { presence, plane } = open()
      const first = await presence.register()
      const second = await presence.register()
      expect(second).not.toBe(first)
      expect(await plane.hostPresent({ hostId: first })).toBe(true)
      expect(await plane.hostPresent({ hostId: second })).toBe(true)
    })

    it('a lost connection fires onLost once and the host is absent', async () => {
      const { presence, plane, lose } = open()
      const lost: number[] = []
      presence.onLost((hostId) => lost.push(hostId))
      const hostId = await presence.register()
      await lose()
      await settle()
      expect(lost).toEqual([hostId])
      expect(await plane.hostPresent({ hostId })).toBe(false)
    })

    it('registering after a loss returns a new present id', async () => {
      const { presence, plane, lose } = open()
      const first = await presence.register()
      await lose()
      await settle()
      const second = await presence.register()
      expect(second).not.toBe(first)
      expect(await plane.hostPresent({ hostId: second })).toBe(true)
    })

    it('close removes presence without firing onLost', async () => {
      const { presence, plane } = open()
      const lost: number[] = []
      presence.onLost((hostId) => lost.push(hostId))
      const hostId = await presence.register()
      await presence.close()
      await settle()
      expect(await plane.hostPresent({ hostId })).toBe(false)
      expect(lost).toEqual([])
    })
  })
}

import { describe, expect, it } from 'bun:test'

import { CHANNEL_PROTOCOL_VERSION } from '../channel-wire'
import { ESandboxProbe } from '../resume-probe'
import { PINNED, STALE, FULL_IDLE, fakeSandbox, probeOf } from './resume-probe-fixture'

describe('probeSandboxForResume protocol rotation', () => {
  const STALE_PROTOCOL = String(CHANNEL_PROTOCOL_VERSION - 1)

  it('keeps a sandbox whose protocol stamp matches, never draining', async () => {
    const sandbox = fakeSandbox({ installed: PINNED })
    let drains = 0

    const result = await probeOf({
      sandbox,
      drain: async () => {
        drains += 1
      },
    })

    expect(result.probe).toBe(ESandboxProbe.Kept)
    expect(drains).toBe(0)
    expect(sandbox.deleted()).toBe(false)
  })

  it('drains a live mismatched serve before deleting it, whatever its runtime is doing', async () => {
    const sandbox = fakeSandbox({ installed: PINNED, protocol: STALE_PROTOCOL })
    const order: string[] = []
    Object.assign(sandbox, {
      delete: async () => {
        order.push('delete')
      },
    })
    const drained: { url: string }[] = []

    const result = await probeOf({
      sandbox,
      health: { ...FULL_IDLE, busy: true, clients: 2 },
      drain: async ({ url }) => {
        order.push('drain')
        drained.push({ url })
      },
    })

    expect(order).toEqual(['drain', 'delete'])
    expect(drained).toEqual([{ url: 'https://sb-3000.vercel.run' }])
    expect(result).toEqual({
      probe: ESandboxProbe.RotationNeeded,
      outdatedProtocol: CHANNEL_PROTOCOL_VERSION - 1,
    })
  })

  it('treats a missing or empty protocol stamp as a serve that predates it', async () => {
    for (const protocol of ['', 'garbage']) {
      const sandbox = fakeSandbox({ installed: PINNED, protocol })
      let drains = 0

      const result = await probeOf({
        sandbox,
        drain: async () => {
          drains += 1
        },
      })

      expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
      expect(result.outdatedProtocol).toBe(0)
      expect(drains).toBe(1)
      expect(sandbox.deleted()).toBe(true)
    }
  })

  it('rotates on protocol drift even when the build version also drifted', async () => {
    const sandbox = fakeSandbox({ installed: STALE, protocol: STALE_PROTOCOL })

    const result = await probeOf({ sandbox, drain: async () => {} })

    expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
    expect(result.rotatedFrom).toBeUndefined()
    expect(sandbox.deleted()).toBe(true)
  })

  it('never deletes or detaches after a failed preparation', async () => {
    for (const reason of [
      'HTTP 404',
      'HTTP 401',
      'timeout',
      'child pause failed',
      'checkpoint failed',
    ]) {
      const sandbox = fakeSandbox({ installed: PINNED, protocol: STALE_PROTOCOL })
      let detached = false
      await expect(
        probeOf({
          sandbox,
          drain: async () => {
            throw new Error(reason)
          },
          waitForDriveDetached: async () => {
            detached = true
            return true
          },
        }),
      ).rejects.toThrow(reason)
      expect(sandbox.deleted()).toBe(false)
      expect(detached).toBe(false)
    }
  })

  it('preserves a protocol-mismatched sandbox when no preparation route exists', async () => {
    const sandbox = fakeSandbox({ installed: PINNED, protocol: STALE_PROTOCOL, routes: [] })
    let drains = 0

    await expect(
      probeOf({
        sandbox,
        drain: async () => {
          drains += 1
        },
      }),
    ).rejects.toThrow('nothing was destroyed')

    expect(drains).toBe(0)
    expect(sandbox.deleted()).toBe(false)
  })

  it('announces the rotation before the drain starts, and survives a throwing callback', async () => {
    const sandbox = fakeSandbox({ installed: PINNED, protocol: STALE_PROTOCOL })
    const order: string[] = []
    const lines: string[] = []

    const result = await probeOf({
      sandbox,
      lines,
      onRotationStarted: () => {
        order.push('started')
        throw new Error('drawer unmounted')
      },
      drain: async () => {
        order.push('drain')
      },
    })

    expect(order).toEqual(['started', 'drain'])
    expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
    expect(lines.some((line) => line.includes('drawer unmounted'))).toBe(true)
  })

  it('announces a build-drift rotation too, and stays quiet for a matching sandbox', async () => {
    let announced = 0
    const onRotationStarted = () => {
      announced += 1
    }

    await probeOf({
      sandbox: fakeSandbox({ installed: STALE }),
      health: FULL_IDLE,
      onRotationStarted,
      drain: async () => undefined,
    })
    await probeOf({ sandbox: fakeSandbox({ installed: PINNED }), onRotationStarted })

    expect(announced).toBe(1)
  })

  it('replaces a stopped sandbox without draining or announcing', async () => {
    const sandbox = fakeSandbox({ installed: STALE, protocol: STALE_PROTOCOL, status: 'stopped' })
    let drains = 0
    let announced = 0

    const result = await probeOf({
      sandbox,
      drain: async () => {
        drains += 1
      },
      onRotationStarted: () => {
        announced += 1
      },
    })

    expect(result.probe).toBe(ESandboxProbe.Replaced)
    expect(drains).toBe(0)
    expect(announced).toBe(0)
  })

  it('does not downgrade a sandbox speaking a newer protocol than this client', async () => {
    const sandbox = fakeSandbox({
      installed: '99.0.0',
      protocol: String(CHANNEL_PROTOCOL_VERSION + 1),
    })
    let drains = 0
    await expect(
      probeOf({
        sandbox,
        drain: async () => {
          drains += 1
        },
      }),
    ).rejects.toThrow('update Atlas')
    expect(drains).toBe(0)
    expect(sandbox.deleted()).toBe(false)
  })

  it('rotates on protocol drift even when the build pins no serve version', async () => {
    const sandbox = fakeSandbox({ installed: PINNED, protocol: STALE_PROTOCOL })

    const result = await probeOf({ sandbox, unpinned: true, drain: async () => undefined })

    expect(result.probe).toBe(ESandboxProbe.RotationNeeded)
    expect(result.outdatedProtocol).toBe(CHANNEL_PROTOCOL_VERSION - 1)
    expect(sandbox.deleted()).toBe(true)
  })

  it('keeps a protocol-matching sandbox when the build pins no serve version, whatever version it carries', async () => {
    const sandbox = fakeSandbox({ installed: '9.9.9' })

    const result = await probeOf({ sandbox, unpinned: true })

    expect(result.probe).toBe(ESandboxProbe.Kept)
    expect(sandbox.deleted()).toBe(false)
  })
})

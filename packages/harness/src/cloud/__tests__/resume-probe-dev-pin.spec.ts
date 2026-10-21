import { describe, expect, it } from 'vitest'

import type { Sandbox } from '@vercel/sandbox'

import { asVercelFailure, isSandboxMissing } from '@dltech/atlas-wire'
import {
  EServeAge,
  ESandboxProbe,
  probeSandboxForResume,
  serveAgeOf,
  servePredatesDrainProtocol,
  type ServeRuntimeHealth,
} from '../resume-probe'
import { FULL_IDLE, fakeSandbox } from './resume-probe-fixture'

const DEV_INSTALLED = 'dev-aaaaaaaaaaaa'
const DEV_PINNED = 'dev-bbbbbbbbbbbb'

const BUSY: ServeRuntimeHealth = { ...FULL_IDLE, busy: true, clients: 1 }

const devProbe = (args: {
  installed: string
  health: ServeRuntimeHealth
  events: string[]
}) =>
  probeSandboxForResume({
    name: 'atlas-thread-x',
    pinned: DEV_PINNED,
    timeoutMs: 5_000,
    servePort: 3000,
    fetch: async () => fakeSandbox({ installed: args.installed }),
    runtimeHealth: async () => args.health,
    serveAlive: async () => true,
    drain: async () => {
      args.events.push('drain')
    },
    swapServe: async (_sandbox: Sandbox) => {
      args.events.push('swap')
    },
    isMissing: isSandboxMissing,
    toFailure: asVercelFailure,
  })

describe('a dev serve pin against the resume probe', () => {
  it('reads a dev pin as an unknown age, never as predating the drain protocol', () => {
    expect(serveAgeOf({ installed: DEV_INSTALLED, pinned: DEV_PINNED })).toBe(EServeAge.Unknown)
    expect(serveAgeOf({ installed: '1.80.0', pinned: DEV_PINNED })).toBe(EServeAge.Unknown)
    expect(servePredatesDrainProtocol(DEV_INSTALLED)).toBe(false)
  })

  it('drains a busy sandbox carrying another dev serve before swapping it in place', async () => {
    const events: string[] = []

    const result = await devProbe({ installed: DEV_INSTALLED, health: BUSY, events })

    expect(events).toEqual(['drain', 'swap'])
    expect(result).toEqual({ probe: ESandboxProbe.Swapped, rotatedFrom: DEV_INSTALLED })
  })

  it('swaps an idle sandbox carrying another dev serve without draining', async () => {
    const events: string[] = []

    const result = await devProbe({ installed: DEV_INSTALLED, health: FULL_IDLE, events })

    expect(events).toEqual(['swap'])
    expect(result.probe).toBe(ESandboxProbe.Swapped)
  })

  it('swaps a release serve onto a dev pin', async () => {
    const events: string[] = []

    const result = await devProbe({ installed: '1.80.0', health: BUSY, events })

    expect(events).toEqual(['drain', 'swap'])
    expect(result.rotatedFrom).toBe('1.80.0')
  })

  it('keeps a sandbox already carrying the pinned dev serve', async () => {
    const events: string[] = []

    const result = await devProbe({ installed: DEV_PINNED, health: BUSY, events })

    expect(events).toEqual([])
    expect(result).toEqual({ probe: ESandboxProbe.Kept })
  })
})

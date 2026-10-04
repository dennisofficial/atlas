import { describe, expect, it } from 'bun:test'

import {
  ERuntimeIdle,
  EServeAge,
  serveAgeOf,
  runtimeIdleOf,
  probeRuntimeActivity,
  type ServeRuntimeHealth,
} from '../resume-probe'
import { FULL_IDLE, healthSandbox } from './resume-probe-fixture'

describe('serveAgeOf', () => {
  it('compares by major, then minor, then patch', () => {
    expect(serveAgeOf({ installed: '1.0.0', pinned: '2.0.0' })).toBe(EServeAge.Older)
    expect(serveAgeOf({ installed: '1.48.2', pinned: '1.49.0' })).toBe(EServeAge.Older)
    expect(serveAgeOf({ installed: '1.48.2', pinned: '1.48.10' })).toBe(EServeAge.Older)
    expect(serveAgeOf({ installed: '2.0.0', pinned: '2.0.0' })).toBe(EServeAge.Same)
    expect(serveAgeOf({ installed: '2.0.1', pinned: '2.0.0' })).toBe(EServeAge.Newer)
    expect(serveAgeOf({ installed: '3.0.0', pinned: '2.9.9' })).toBe(EServeAge.Newer)
  })

  it('reads unparsable versions as unknown', () => {
    expect(serveAgeOf({ installed: '', pinned: '2.0.0' })).toBe(EServeAge.Unknown)
    expect(serveAgeOf({ installed: 'release-branch', pinned: '2.0.0' })).toBe(EServeAge.Unknown)
    expect(serveAgeOf({ installed: '1.2', pinned: '2.0.0' })).toBe(EServeAge.Unknown)
    expect(serveAgeOf({ installed: '1.2.x', pinned: '2.0.0' })).toBe(EServeAge.Unknown)
  })
})

describe('runtimeIdleOf', () => {
  it('reads undefined health as unknown', () => {
    expect(runtimeIdleOf(undefined)).toBe(ERuntimeIdle.Unknown)
  })

  it('reads a fully quiet answer as idle', () => {
    expect(runtimeIdleOf(FULL_IDLE)).toBe(ERuntimeIdle.Idle)
  })

  it('reads any single missing guarded field as unknown', () => {
    const withoutClients: ServeRuntimeHealth = { ...FULL_IDLE }
    delete withoutClients.clients
    expect(runtimeIdleOf(withoutClients)).toBe(ERuntimeIdle.Unknown)
  })

  it('reads legacy turnRunning alone as busy, never as proof of idleness', () => {
    expect(runtimeIdleOf({ ...FULL_IDLE, turnRunning: true })).toBe(ERuntimeIdle.Busy)
    expect(runtimeIdleOf({ turnRunning: false, clients: 0 })).toBe(ERuntimeIdle.Unknown)
  })
})

describe('probeRuntimeActivity', () => {
  it('parses a complete activity answer', async () => {
    const sandbox = healthSandbox({ body: JSON.stringify(FULL_IDLE) })

    const health = await probeRuntimeActivity({ sandbox, url: 'https://sb-3000.vercel.run' })

    expect(health).toEqual(FULL_IDLE)
  })

  it('reads a failed health fetch as unknown, not as unattached', async () => {
    for (const sandbox of [
      healthSandbox({ exitCode: 1 }),
      healthSandbox({ throws: true }),
      healthSandbox({ body: '' }),
      healthSandbox({ body: 'not json' }),
      healthSandbox({ body: JSON.stringify({ clients: 'many' }) }),
    ]) {
      const health = await probeRuntimeActivity({ sandbox, url: 'https://sb-3000.vercel.run' })
      expect(health).toBeUndefined()
    }
  })

  it('tolerates extra fields a newer serve reports', async () => {
    const sandbox = healthSandbox({
      body: JSON.stringify({ ...FULL_IDLE, uptimeMs: 42, workspace: { state: 'ready' } }),
    })

    const health = await probeRuntimeActivity({ sandbox, url: 'https://sb-3000.vercel.run' })

    expect(health).toMatchObject(FULL_IDLE)
  })
})

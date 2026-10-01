import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import {
  acceptsRuntimeCheckpoint,
  persistRuntimeCheckpoint,
  readPersistedRuntimeCheckpoint,
  RUNTIME_CHECKPOINT_RELATIVE_PATH,
  runtimeCheckpointFile,
} from '../runtime-checkpoint'

const homes: string[] = []

const scratchHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-checkpoint-spec-'))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const checkpoint = (overrides: Partial<RuntimeCheckpoint> = {}): RuntimeCheckpoint => ({
  threadId: 'thread-1',
  runtimeId: 'runtime-1',
  sandboxSessionId: 'sandbox-session-1',
  revision: 1,
  phase: ERuntimePhase.Running,
  reportedAt: '2026-10-01T12:00:00.000Z',
  transcript: { head: 3, count: 3, digest: 'a'.repeat(64) },
  ...overrides,
})

describe('runtimeCheckpointFile', () => {
  it('lives under the operational directory, never the event log', () => {
    expect(runtimeCheckpointFile({ atlasHome: '/atlas/home' })).toBe(
      join('/atlas/home', 'operational', 'runtime-checkpoint.json'),
    )
    expect(RUNTIME_CHECKPOINT_RELATIVE_PATH).not.toContain('events')
  })
})

describe('readPersistedRuntimeCheckpoint', () => {
  it('returns null when no checkpoint has been persisted', async () => {
    const file = runtimeCheckpointFile({ atlasHome: scratchHome() })
    await expect(readPersistedRuntimeCheckpoint({ file })).resolves.toBeNull()
  })

  it('round-trips a persisted checkpoint', async () => {
    const file = runtimeCheckpointFile({ atlasHome: scratchHome() })
    const stored = checkpoint({ revision: 4 })
    await persistRuntimeCheckpoint({ file, checkpoint: stored })
    await expect(readPersistedRuntimeCheckpoint({ file })).resolves.toEqual(stored)
  })

  it('returns null for a torn write', async () => {
    const home = scratchHome()
    const file = runtimeCheckpointFile({ atlasHome: home })
    await persistRuntimeCheckpoint({ file, checkpoint: checkpoint() })
    writeFileSync(file, '{"revision":')
    await expect(readPersistedRuntimeCheckpoint({ file })).resolves.toBeNull()
  })

  it('returns null for a checkpoint that fails the wire schema', async () => {
    const home = scratchHome()
    const file = runtimeCheckpointFile({ atlasHome: home })
    await persistRuntimeCheckpoint({ file, checkpoint: checkpoint() })
    writeFileSync(file, `${JSON.stringify(checkpoint({ revision: 0 }))}\n`)
    await expect(readPersistedRuntimeCheckpoint({ file })).resolves.toBeNull()
  })
})

describe('persistRuntimeCheckpoint', () => {
  it('creates the operational directory on first write', async () => {
    const file = runtimeCheckpointFile({ atlasHome: scratchHome() })
    await persistRuntimeCheckpoint({ file, checkpoint: checkpoint() })
    await expect(readPersistedRuntimeCheckpoint({ file })).resolves.toEqual(checkpoint())
  })

  it('keeps the newest revision across writes', async () => {
    const file = runtimeCheckpointFile({ atlasHome: scratchHome() })
    await persistRuntimeCheckpoint({ file, checkpoint: checkpoint({ revision: 7 }) })
    await persistRuntimeCheckpoint({
      file,
      checkpoint: checkpoint({ revision: 8, phase: ERuntimePhase.Parked }),
    })
    const persisted = await readPersistedRuntimeCheckpoint({ file })
    expect(persisted?.revision).toBe(8)
    expect(persisted?.phase).toBe(ERuntimePhase.Parked)
  })

  it('refuses to persist an older revision over a newer one', async () => {
    const file = runtimeCheckpointFile({ atlasHome: scratchHome() })
    await persistRuntimeCheckpoint({ file, checkpoint: checkpoint({ revision: 9 }) })
    await expect(
      persistRuntimeCheckpoint({ file, checkpoint: checkpoint({ revision: 5 }) }),
    ).rejects.toThrow(/newer 9/)
    expect((await readPersistedRuntimeCheckpoint({ file }))?.revision).toBe(9)
  })

  it('accepts an exact same-revision duplicate but refuses a changed one', async () => {
    const file = runtimeCheckpointFile({ atlasHome: scratchHome() })
    const stored = checkpoint({ revision: 9, phase: ERuntimePhase.Parked })
    await persistRuntimeCheckpoint({ file, checkpoint: stored })
    await persistRuntimeCheckpoint({ file, checkpoint: stored })
    await expect(
      persistRuntimeCheckpoint({
        file,
        checkpoint: checkpoint({ revision: 9, phase: ERuntimePhase.Running }),
      }),
    ).rejects.toThrow(/already taken/)
    expect((await readPersistedRuntimeCheckpoint({ file }))?.phase).toBe(ERuntimePhase.Parked)
  })

  it('refuses to seed a fresh revision over an unreadable file', async () => {
    const home = scratchHome()
    const file = runtimeCheckpointFile({ atlasHome: home })
    await persistRuntimeCheckpoint({ file, checkpoint: checkpoint({ revision: 9 }) })
    writeFileSync(file, '{"revision":')
    await expect(
      persistRuntimeCheckpoint({ file, checkpoint: checkpoint({ revision: 1 }) }),
    ).rejects.toThrow(/newer|unreadable/i)
  })
})

describe('acceptsRuntimeCheckpoint', () => {
  it('accepts strictly newer revisions only: older, equal, and altered-equal all drop', () => {
    const stored = checkpoint({ revision: 4, phase: ERuntimePhase.Parked })
    expect(acceptsRuntimeCheckpoint({ stored: null, reported: checkpoint() })).toBe(true)
    expect(
      acceptsRuntimeCheckpoint({ stored, reported: checkpoint({ revision: 5 }) }),
    ).toBe(true)
    expect(
      acceptsRuntimeCheckpoint({ stored, reported: checkpoint({ revision: 3 }) }),
    ).toBe(false)
    expect(acceptsRuntimeCheckpoint({ stored, reported: stored })).toBe(false)
    expect(
      acceptsRuntimeCheckpoint({
        stored,
        reported: checkpoint({ revision: 4, phase: ERuntimePhase.Running }),
      }),
    ).toBe(false)
  })
})

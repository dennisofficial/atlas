import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ATLAS_TELEMETRY_IDENTITY_ENV } from '@dltech/atlas-core'

import { persistedTelemetryDistinctId, TELEMETRY_FILE_NAME, telemetryDistinctId } from '../identity'

const OPERATOR_ID = '0fe781a8-3c2c-4f97-8d36-7f1b6f2a0a11'

describe('telemetryDistinctId', () => {
  it('generates a uuid and reuses it on the next read', () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-telemetry-'))
    try {
      const first = telemetryDistinctId({ atlasHome: home })
      const second = telemetryDistinctId({ atlasHome: home })

      expect(first).toMatch(/^[0-9a-f-]{36}$/)
      expect(second).toBe(first)

      const persisted = JSON.parse(readFileSync(join(home, TELEMETRY_FILE_NAME), 'utf8'))
      expect(persisted.distinctId).toBe(first)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('regenerates when the file holds garbage', () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-telemetry-'))
    try {
      const id = telemetryDistinctId({ atlasHome: home })
      expect(id).toMatch(/^[0-9a-f-]{36}$/)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('answers unknown rather than throwing when the home is unwritable', () => {
    const id = telemetryDistinctId({ atlasHome: '/proc/atlas-cannot-exist' })
    expect(id).toBe('unknown')
  })

  it('adopts the operator id the sandbox boot carries and persists it', () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-telemetry-'))
    try {
      const id = telemetryDistinctId({
        atlasHome: home,
        env: { [ATLAS_TELEMETRY_IDENTITY_ENV]: OPERATOR_ID },
      })

      expect(id).toBe(OPERATOR_ID)
      const persisted = JSON.parse(readFileSync(join(home, TELEMETRY_FILE_NAME), 'utf8'))
      expect(persisted.distinctId).toBe(OPERATOR_ID)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('re-seeds over a stale persisted id when the operator id arrives', () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-telemetry-'))
    try {
      writeFileSync(
        join(home, TELEMETRY_FILE_NAME),
        `${JSON.stringify({ distinctId: '9b2f5a1c-0000-4000-8000-aaaaaaaaaaaa' })}\n`,
      )
      const id = telemetryDistinctId({
        atlasHome: home,
        env: { [ATLAS_TELEMETRY_IDENTITY_ENV]: OPERATOR_ID },
      })

      expect(id).toBe(OPERATOR_ID)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('ignores a malformed identity env and falls back to the local id', () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-telemetry-'))
    try {
      const id = telemetryDistinctId({
        atlasHome: home,
        env: { [ATLAS_TELEMETRY_IDENTITY_ENV]: 'not-a-uuid' },
      })

      expect(id).not.toBe('not-a-uuid')
      expect(id).toMatch(/^[0-9a-f-]{36}$/)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('persistedTelemetryDistinctId', () => {
  it('returns the persisted id without minting one', () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-telemetry-'))
    try {
      writeFileSync(
        join(home, TELEMETRY_FILE_NAME),
        `${JSON.stringify({ distinctId: OPERATOR_ID })}\n`,
      )
      expect(persistedTelemetryDistinctId({ atlasHome: home })).toBe(OPERATOR_ID)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('returns undefined when nothing was persisted', () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-telemetry-'))
    try {
      expect(persistedTelemetryDistinctId({ atlasHome: home })).toBeUndefined()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { telemetryDistinctId } from '../identity'

describe('telemetryDistinctId', () => {
  it('generates a uuid and reuses it on the next read', () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-telemetry-'))
    try {
      const first = telemetryDistinctId({ atlasHome: home })
      const second = telemetryDistinctId({ atlasHome: home })

      expect(first).toMatch(/^[0-9a-f-]{36}$/)
      expect(second).toBe(first)

      const persisted = JSON.parse(readFileSync(join(home, 'telemetry.json'), 'utf8'))
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
})

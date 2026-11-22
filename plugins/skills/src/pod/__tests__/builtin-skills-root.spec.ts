import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { BUILT_IN_SKILL_CATALOGUE } from '../../catalogue'
import { builtInSkillsRoot } from '../builtin-skills-root'

const digestOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

describe('builtInSkillsRoot', () => {
  it('points at the SKILL.md and the resources the catalogue digests', async () => {
    const root = builtInSkillsRoot()

    for (const skill of BUILT_IN_SKILL_CATALOGUE) {
      const entry = await readFile(join(root, skill.name, skill.entry.path))
      expect(digestOf(entry)).toBe(skill.entry.digest)
      expect(entry.byteLength).toBe(skill.entry.sizeBytes)

      for (const file of skill.files) {
        const bytes = await readFile(join(root, skill.name, file.path))
        expect(digestOf(bytes)).toBe(file.digest)
        expect(bytes.byteLength).toBe(file.sizeBytes)
      }
    }
  })
})

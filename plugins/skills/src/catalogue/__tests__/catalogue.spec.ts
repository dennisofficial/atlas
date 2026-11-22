import { createHash } from 'node:crypto'

import { describe, expect, it } from 'bun:test'

import { BUILT_IN_SKILLS } from '../../pod/builtin.generated'
import { BUILT_IN_SKILL_CATALOGUE } from '../catalogue.generated'
import { builtInSkillEntry, builtInSkillNames, builtInSkills, isBuiltInSkillName } from '../lookup'

const digestOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

describe('BUILT_IN_SKILL_CATALOGUE', () => {
  it('holds one entry per built-in skill, in name order', () => {
    expect(BUILT_IN_SKILL_CATALOGUE.map((skill) => skill.name)).toEqual(
      BUILT_IN_SKILLS.map((skill) => skill.name).sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    )
    expect(builtInSkills()).toBe(BUILT_IN_SKILL_CATALOGUE)
  })

  it('digests the entry text of each built-in skill', () => {
    const texts = new Map(BUILT_IN_SKILLS.map((skill) => [skill.name, skill.text]))
    for (const skill of BUILT_IN_SKILL_CATALOGUE) {
      const text = Buffer.from(texts.get(skill.name) ?? '', 'utf8')
      expect(skill.entry).toEqual({
        path: 'SKILL.md',
        digest: digestOf(text),
        sizeBytes: text.byteLength,
      })
      expect(skill.updatedAt).toBe(new Date(0).toISOString())
    }
  })

  it('lists the resource files of each built-in skill with their digest and text kind', () => {
    const resources = new Map(BUILT_IN_SKILLS.map((skill) => [skill.name, skill.files]))
    const all = BUILT_IN_SKILL_CATALOGUE.flatMap((skill) => skill.files)
    for (const skill of BUILT_IN_SKILL_CATALOGUE) {
      expect(skill.files.map((file) => file.path)).toEqual(
        (resources.get(skill.name) ?? []).map((file) => file.path),
      )
      for (const file of skill.files) {
        expect(file.digest).toMatch(/^[0-9a-f]{64}$/)
        expect(file.sizeBytes).toBeGreaterThan(0)
      }
    }
    for (const file of all) {
      expect(file.isText).toBe(!/\.(?:png|jpe?g|gif|webp|pdf|zip|woff2?)$/.test(file.path))
    }
    expect(all.some((file) => !file.isText)).toBe(true)
  })

  it('looks a skill up by name, ignoring case', () => {
    expect(builtInSkillEntry('commit')?.name).toBe('commit')
    expect(builtInSkillEntry('COMMIT')?.name).toBe('commit')
    expect(builtInSkillEntry('no-such-skill')).toBeUndefined()
    expect(isBuiltInSkillName('UI-Design')).toBe(true)
    expect(isBuiltInSkillName('no-such-skill')).toBe(false)
    expect([...builtInSkillNames()]).toEqual(BUILT_IN_SKILL_CATALOGUE.map((skill) => skill.name))
  })
})

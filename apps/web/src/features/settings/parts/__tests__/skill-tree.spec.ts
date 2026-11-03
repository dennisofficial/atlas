import { describe, expect, it } from 'bun:test'

import { buildSkillTree } from '../skill-tree'
import { ESkillFileKind, fileKindOf, formatBytes } from '../skill-format'

describe('buildSkillTree', () => {
  it('builds nested folders with SKILL.md first among files', () => {
    const tree = buildSkillTree([
      'references/type-scale.md',
      'SKILL.md',
      'references/empty-states.md',
      'scripts/fetch.ts',
      'assets/logo.png',
    ])
    expect(tree.map((node) => node.name)).toEqual(['assets', 'references', 'scripts', 'SKILL.md'])
    const references = tree.find((node) => node.name === 'references')
    expect(references?.folder).toBe(true)
    expect(references?.children.map((node) => node.path)).toEqual([
      'references/empty-states.md',
      'references/type-scale.md',
    ])
  })

  it('marks leaves as files with their full path', () => {
    const tree = buildSkillTree(['SKILL.md'])
    expect(tree[0]).toMatchObject({ name: 'SKILL.md', path: 'SKILL.md', folder: false })
  })

  it('shares folder nodes across files', () => {
    const tree = buildSkillTree(['a/b.md', 'a/c.md'])
    expect(tree).toHaveLength(1)
    expect(tree[0]?.children).toHaveLength(2)
  })
})

describe('fileKindOf', () => {
  it('uses the shared wire extension set', () => {
    expect(fileKindOf('SKILL.md')).toBe(ESkillFileKind.Text)
    expect(fileKindOf('scripts/fetch.ts')).toBe(ESkillFileKind.Text)
    expect(fileKindOf('notes.yaml')).toBe(ESkillFileKind.Text)
    expect(fileKindOf('assets/logo.png')).toBe(ESkillFileKind.Binary)
    expect(fileKindOf('Makefile')).toBe(ESkillFileKind.Binary)
  })
})

describe('formatBytes', () => {
  it('formats byte ranges', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})

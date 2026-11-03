import { describe, expect, it } from 'bun:test'
import type { SkillFileMeta } from '@dltech/atlas-wire/web'

import { defaultSkillPath } from '../skill-default-path'

function meta(path: string, isText = true): SkillFileMeta {
  return {
    path,
    isText,
    sizeBytes: 10,
    updatedAt: '2026-11-01T00:00:00Z',
  } as SkillFileMeta
}

describe('defaultSkillPath', () => {
  it('returns null when there are no files', () => {
    expect(defaultSkillPath({ metas: [] })).toBeNull()
  })

  it('opens SKILL.md by default', () => {
    expect(defaultSkillPath({ metas: [meta('notes.md'), meta('SKILL.md')] })).toBe('SKILL.md')
  })

  it('falls back to the first text file when there is no SKILL.md', () => {
    expect(defaultSkillPath({ metas: [meta('logo.png', false), meta('guide.md')] })).toBe(
      'guide.md',
    )
  })

  it('falls back to the first file when nothing is text', () => {
    expect(defaultSkillPath({ metas: [meta('logo.png', false), meta('run.sh', false)] })).toBe(
      'logo.png',
    )
  })
})

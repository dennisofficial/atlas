import { describe, expect, it } from 'bun:test'

import { ESkillFileKind, fileKindOf, formatBytes, formatSkillDate } from '../skill-format'

describe('fileKindOf', () => {
  it('treats the text extensions as text', () => {
    expect(fileKindOf('SKILL.md')).toBe(ESkillFileKind.Text)
    expect(fileKindOf('scripts/run.sh')).toBe(ESkillFileKind.Text)
    expect(fileKindOf('REFERENCE.MD')).toBe(ESkillFileKind.Text)
  })

  it('treats everything else as binary', () => {
    expect(fileKindOf('assets/logo.png')).toBe(ESkillFileKind.Binary)
    expect(fileKindOf('LICENSE')).toBe(ESkillFileKind.Binary)
    expect(fileKindOf('SKILL')).toBe(ESkillFileKind.Binary)
  })
})

describe('formatBytes', () => {
  it('scales from bytes to kilobytes to megabytes', () => {
    expect(formatBytes(12)).toBe('12 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})

describe('formatSkillDate', () => {
  it('formats a UTC timestamp as a short month and day', () => {
    expect(formatSkillDate('2026-11-01T00:00:00Z')).toBe('Nov 1')
  })
})

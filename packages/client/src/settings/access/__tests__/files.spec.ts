import { describe, expect, it } from 'bun:test'
import { ERepoTreeEntryKind } from '@dltech/atlas-wire/web'

import {
  accessFileValidation,
  DEFAULT_MODE_TEXT,
  formatFileMode,
  MAX_PICKER_CHOICES,
  parseFileMode,
  pickerChoices,
} from '../files'

const file = { path: '~/file.txt', contents: 'text', modeText: DEFAULT_MODE_TEXT, personal: true }

describe('file modes', () => {
  it('accepts only three octal digits, with an optional leading zero', () => {
    for (const text of ['600', '0600', ' 0600 ']) expect(parseFileMode(text)).toBe(0o600)
    for (const text of ['', '60', '00600', '888', '-600', '0o600', '600x'])
      expect(parseFileMode(text)).toBeNull()
    expect(parseFileMode('000')).toBe(0)
    expect(parseFileMode('777')).toBe(0o777)
  })
  it('formats an octal label', () => {
    expect(formatFileMode(0)).toBe('0000')
    expect(formatFileMode(0o600)).toBe(DEFAULT_MODE_TEXT)
    expect(formatFileMode(0o755)).toBe('0755')
  })
})

describe('file draft validation', () => {
  it('trims paths, keeps contents unchanged and builds the save payload', () => {
    expect(accessFileValidation({ ...file, path: ' ~/file.txt ', contents: '' }).draft).toEqual({
      path: '~/file.txt',
      contents: '',
      mode: 0o600,
    })
    expect(accessFileValidation({ ...file, path: '@/file.txt' }).draft).not.toBeNull()
  })
  it('uses personal versus project and group path rules', () => {
    expect(accessFileValidation({ ...file, path: 'file.txt' }).draft).toBeNull()
    expect(
      accessFileValidation({ ...file, path: 'file.txt', personal: false }).draft,
    ).not.toBeNull()
    for (const path of ['/tmp/ios-settings-check.txt', '../file', '.git/config', 'folder//file']) {
      expect(accessFileValidation({ ...file, path, personal: false }).draft).toBeNull()
    }
    expect(accessFileValidation({ ...file, path: '' }).pathProblem).toBeNull()
    expect(accessFileValidation({ ...file, path: ' ' }).draft).toBeNull()
  })
  it('rejects invalid modes', () => {
    expect(accessFileValidation({ ...file, modeText: '999' }).draft).toBeNull()
    expect(accessFileValidation({ ...file, modeText: '999' }).mode).toBeNull()
  })
  it('enforces 64 KiB as UTF-8 bytes, not characters', () => {
    expect(accessFileValidation({ ...file, contents: 'x'.repeat(65536) }).draft).not.toBeNull()
    expect(accessFileValidation({ ...file, contents: 'x'.repeat(65537) }).contentsTooLarge).toBe(
      true,
    )
    expect(accessFileValidation({ ...file, contents: 'é'.repeat(32769) }).draft).toBeNull()
  })
})

describe('repository path choices', () => {
  const entries = [
    { path: 'src', kind: ERepoTreeEntryKind.Folder },
    { path: 'src/file.ts', kind: ERepoTreeEntryKind.File },
    { path: 'a-src', kind: ERepoTreeEntryKind.File },
    { path: 'SRC.ts', kind: ERepoTreeEntryKind.File },
  ]
  it('ranks prefix matches first then length, ignoring query case', () => {
    expect(pickerChoices({ entries, query: ' SRC ' })).toEqual([
      'src/',
      'SRC.ts',
      'src/file.ts',
      'a-src',
    ])
    expect(pickerChoices({ entries, query: 'missing' })).toEqual([])
    expect(pickerChoices({ entries, query: '~/' })).toEqual([])
  })
  it('limits choices without mutating the tree', () => {
    const many = Array.from({ length: 70 }, (_, i) => ({
      path: `${i}.txt`,
      kind: ERepoTreeEntryKind.File,
    }))
    expect(pickerChoices({ entries: many, query: '' })).toHaveLength(MAX_PICKER_CHOICES)
    expect(many[0]?.path).toBe('0.txt')
  })
})

import { describe, expect, it } from 'bun:test'

import { isValidTreePath, normalizeTreePath } from '../tree-paths'

describe('isValidTreePath', () => {
  it.each([
    'MEMORY.md',
    'dir/name.md',
    'a/b/c/d.txt',
    '.hidden',
    'dir/.hidden/file',
    'file with spaces.md',
    'a..b/c',
    '...',
    'x'.repeat(500),
  ])('accepts %j', (path) => {
    expect(isValidTreePath(path)).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['over 500 chars', 'x'.repeat(501)],
    ['absolute', '/etc/passwd'],
    ['drive letter', 'C:/Users/x'],
    ['drive letter, bare', 'c:foo'],
    ['empty segment', 'a//b'],
    ['trailing slash', 'a/b/'],
    ['dot segment', 'a/./b'],
    ['leading dot segment', './a'],
    ['dotdot segment', 'a/../b'],
    ['leading dotdot', '../a'],
    ['only dotdot', '..'],
    ['backslash', 'a\\b'],
    ['NUL', 'a\0b'],
    ['leading space in a segment', 'a/ b'],
    ['trailing space in a segment', 'a /b'],
    ['trailing space at end', 'a/b '],
    ['leading space at start', ' a/b'],
    ['tab edge', 'a/b\t'],
    ['whitespace-only segment', 'a/ /b'],
  ])('rejects %s', (_label, path) => {
    expect(isValidTreePath(path)).toBe(false)
  })
})

describe('normalizeTreePath', () => {
  it.each([
    ['a//b', 'a/b'],
    ['a///b//c', 'a/b/c'],
    ['./a/b', 'a/b'],
    ['././a', 'a'],
    ['.//a', 'a'],
    ['a/./b', 'a/./b'],
    ['a/b', 'a/b'],
    ['', ''],
    ['a/b/', 'a/b/'],
    ['../a', '../a'],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeTreePath(input)).toBe(expected)
  })
})

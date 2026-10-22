import { describe, expect, it } from 'bun:test'

import { conflictCopyName } from '../conflict-copy-name'

describe('conflictCopyName', () => {
  it.each([
    ['name.md', 'abc', 'name.conflict-abc.md'],
    ['dir/name.md', 'abc', 'dir/name.conflict-abc.md'],
    ['a/b/c/name.md', 'abc', 'a/b/c/name.conflict-abc.md'],
    ['dir/name.txt', 'abc', 'dir/name.conflict-abc.txt'],
    ['dir/name', 'abc', 'dir/name.conflict-abc'],
    ['name', 'abc', 'name.conflict-abc'],
    ['dir.v2/name', 'abc', 'dir.v2/name.conflict-abc'],
    ['dir/archive.tar.gz', 'abc', 'dir/archive.tar.conflict-abc.gz'],
    ['dir/.env', 'abc', 'dir/.env.conflict-abc'],
    ['dir/name.', 'abc', 'dir/name..conflict-abc'],
  ])('%s + %s -> %s', (path, deviceId, expected) => {
    expect(conflictCopyName({ path, deviceId })).toBe(expected)
  })

  it('replaces characters outside [a-zA-Z0-9-] in the device id with dashes', () => {
    expect(conflictCopyName({ path: 'dir/name.md', deviceId: "Dennis's Mac_Pro.local" })).toBe(
      'dir/name.conflict-Dennis-s-Mac-Pro-local.md',
    )
    expect(conflictCopyName({ path: 'n.md', deviceId: '../x/y' })).toBe('n.conflict----x-y.md')
  })

  it('keeps dashes and alphanumerics in the device id', () => {
    expect(conflictCopyName({ path: 'n.md', deviceId: 'Dev-01' })).toBe('n.conflict-Dev-01.md')
  })
})

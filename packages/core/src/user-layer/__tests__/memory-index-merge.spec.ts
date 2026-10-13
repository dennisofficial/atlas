import { describe, expect, it } from 'bun:test'

import { mergeMemoryIndexes } from '../memory-index-merge'

const doc = (...lines: string[]): string => `${lines.join('\n')}\n`

describe('mergeMemoryIndexes', () => {
  it('unions entries by filename, prefer side first then the other side appended', () => {
    const local = doc('- [A](a.md) — a', '- [B](b.md) — b')
    const remote = doc('- [C](c.md) — c', '- [A](a.md) — a')

    expect(mergeMemoryIndexes({ local, remote, prefer: 'local' })).toBe(
      doc('- [A](a.md) — a', '- [B](b.md) — b', '- [C](c.md) — c'),
    )
    expect(mergeMemoryIndexes({ local, remote, prefer: 'remote' })).toBe(
      doc('- [C](c.md) — c', '- [A](a.md) — a', '- [B](b.md) — b'),
    )
  })

  it('keeps one copy of an identical entry', () => {
    const both = doc('- [A](a.md) — same')
    expect(mergeMemoryIndexes({ local: both, remote: both, prefer: 'local' })).toBe(both)
  })

  it('lets the preferred side win a same-filename conflict, in both directions', () => {
    const local = doc('- [A](a.md) — local hook')
    const remote = doc('- [A renamed](a.md) — remote hook')

    expect(mergeMemoryIndexes({ local, remote, prefer: 'local' })).toBe(local)
    expect(mergeMemoryIndexes({ local, remote, prefer: 'remote' })).toBe(remote)
  })

  it('keeps the preferred side header and drops the other', () => {
    const local = doc('# Local header', '', '- [A](a.md) — a')
    const remote = doc('# Remote header', 'extra line', '', '- [B](b.md) — b')

    expect(mergeMemoryIndexes({ local, remote, prefer: 'local' })).toBe(
      doc('# Local header', '', '- [A](a.md) — a', '- [B](b.md) — b'),
    )
    expect(mergeMemoryIndexes({ local, remote, prefer: 'remote' })).toBe(
      doc('# Remote header', 'extra line', '', '- [B](b.md) — b', '- [A](a.md) — a'),
    )
  })

  it('keeps the other side unchanged when one side is empty', () => {
    const only = '# Header\n- [A](a.md) — a'
    expect(mergeMemoryIndexes({ local: '', remote: only, prefer: 'local' })).toBe(only)
    expect(mergeMemoryIndexes({ local: only, remote: '', prefer: 'remote' })).toBe(only)
    expect(mergeMemoryIndexes({ local: '', remote: '', prefer: 'local' })).toBe('')
  })

  it('preserves a trailing newline when either side has one', () => {
    const withNewline = '- [A](a.md) — a\n'
    const without = '- [B](b.md) — b'

    expect(mergeMemoryIndexes({ local: withNewline, remote: without, prefer: 'remote' })).toBe(
      '- [B](b.md) — b\n- [A](a.md) — a\n',
    )
    expect(mergeMemoryIndexes({ local: without, remote: without, prefer: 'local' })).toBe(without)
  })

  it('keeps unparseable list-looking lines verbatim, keyed by their own text', () => {
    const local = doc('- [Broken](no-close', '- [A](a.md) — a')
    const remote = doc('- [Broken](no-close', '- [Other broken', '- [A](a.md) — a')

    expect(mergeMemoryIndexes({ local, remote, prefer: 'local' })).toBe(
      doc('- [Broken](no-close', '- [A](a.md) — a', '- [Other broken'),
    )
  })

  it('treats a header-only side as having no entries', () => {
    const local = doc('# Only a header')
    const remote = doc('# Remote', '- [A](a.md) — a')

    expect(mergeMemoryIndexes({ local, remote, prefer: 'local' })).toBe(
      doc('# Only a header', '- [A](a.md) — a'),
    )
  })

  it('is idempotent: merging the result in again changes nothing', () => {
    const x = doc('# X', '- [A](a.md) — x', '- [B](b.md) — b')
    const y = doc('# Y', '- [A](a.md) — y', '- [C](c.md) — c')

    for (const prefer of ['local', 'remote'] as const) {
      const once = mergeMemoryIndexes({ local: x, remote: y, prefer })
      const sides = prefer === 'local' ? { local: x, remote: once } : { local: once, remote: y }
      expect(mergeMemoryIndexes({ ...sides, prefer })).toBe(once)
    }
  })
})

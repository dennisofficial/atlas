import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { createPathResolver } from '../path-resolver'

function fixture(): { root: string; home: string } {
  const base = mkdtempSync(join(tmpdir(), 'path-resolver-'))
  const root = join(base, 'proj')
  const home = join(base, 'home')
  mkdirSync(join(root, 'apps/tui'), { recursive: true })
  mkdirSync(join(home, 'docs'), { recursive: true })
  writeFileSync(join(root, 'apps/tui/inline.ts'), '')
  writeFileSync(join(root, 'package.json'), '{}')
  writeFileSync(join(home, 'docs/note.md'), '')
  return { root, home }
}

describe('createPathResolver', () => {
  it('resolves a relative mention against the root and carries the line', () => {
    const { root, home } = fixture()
    const resolve = createPathResolver({ root, home })
    expect(resolve({ path: 'apps/tui/inline.ts', line: 42 })).toEqual({
      path: join(root, 'apps/tui/inline.ts'),
      line: 42,
    })
  })

  it('expands a home mention and stands an absolute alone', () => {
    const { root, home } = fixture()
    const resolve = createPathResolver({ root, home })
    expect(resolve({ path: '~/docs/note.md' })).toEqual({ path: join(home, 'docs/note.md') })
    expect(resolve({ path: join(root, 'package.json') })).toEqual({
      path: join(root, 'package.json'),
    })
  })

  it('returns null for prose that is not a path, so it never links', () => {
    const { root, home } = fixture()
    const resolve = createPathResolver({ root, home })
    expect(resolve({ path: 'foundation/structure/etc' })).toBeNull()
    expect(resolve({ path: 'recovery/reconciliation' })).toBeNull()
    expect(resolve({ path: 'does/not/exist.ts' })).toBeNull()
  })

  it('caches both hits and misses rather than re-statting every chunk', () => {
    const { root, home } = fixture()
    const resolve = createPathResolver({ root, home })
    expect(resolve({ path: 'package.json' })).not.toBeNull()
    expect(resolve({ path: 'nope-missing' })).toBeNull()
    // A file created after a cached miss stays missed until the cache turns over; the click
    // re-check is the freshness guarantee, the cache is the streaming-throughput one.
    writeFileSync(join(root, 'nope-missing'), '')
    expect(resolve({ path: 'nope-missing' })).toBeNull()
  })
})

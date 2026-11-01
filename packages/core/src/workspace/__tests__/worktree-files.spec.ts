import { describe, expect, it } from 'bun:test'

import {
  EWorktreeFileMode,
  EWorktreeFileSkip,
  EWorktreeFilesState,
  EWorktreePatternRefusal,
  describeWorktreeFiles,
  planWorktreeFiles,
  readWorktreeFilesDocument,
  worktreePatternMatches,
  worktreePatternRefusal,
} from '../worktree-files'

describe('worktreePatternMatches', () => {
  it('matches exact paths only exactly', () => {
    expect(
      worktreePatternMatches({
        pattern: 'apps/api/envs/.env.keys',
        path: 'apps/api/envs/.env.keys',
      }),
    ).toBe(true)
    expect(
      worktreePatternMatches({ pattern: 'apps/api/envs/.env.keys', path: 'apps/api/envs/.env' }),
    ).toBe(false)
  })

  it('keeps * and ? inside one segment', () => {
    expect(
      worktreePatternMatches({ pattern: 'apps/*/.env.local', path: 'apps/web/.env.local' }),
    ).toBe(true)
    expect(
      worktreePatternMatches({ pattern: 'apps/*/.env.local', path: 'apps/a/b/.env.local' }),
    ).toBe(false)
    expect(worktreePatternMatches({ pattern: 'f?.txt', path: 'f1.txt' })).toBe(true)
    expect(worktreePatternMatches({ pattern: 'f?.txt', path: 'f12.txt' })).toBe(false)
  })

  it('lets ** span zero or more segments', () => {
    expect(worktreePatternMatches({ pattern: '**/.env', path: '.env' })).toBe(true)
    expect(worktreePatternMatches({ pattern: '**/.env', path: 'a/b/.env' })).toBe(true)
    expect(worktreePatternMatches({ pattern: 'apps/**/x', path: 'apps/x' })).toBe(true)
    expect(worktreePatternMatches({ pattern: 'apps/**/x', path: 'lib/x' })).toBe(false)
  })

  it('treats regex characters literally', () => {
    expect(worktreePatternMatches({ pattern: '*.env.(1)', path: 'a.env.(1)' })).toBe(true)
    expect(worktreePatternMatches({ pattern: '*.env', path: 'axenv' })).toBe(false)
  })
})

describe('worktreePatternRefusal', () => {
  it('refuses absolute paths, .., the root and .git', () => {
    expect(worktreePatternRefusal('/etc/passwd')).toBe(EWorktreePatternRefusal.Absolute)
    expect(worktreePatternRefusal('~/secret')).toBe(EWorktreePatternRefusal.Absolute)
    expect(worktreePatternRefusal('C:\\x')).toBe(EWorktreePatternRefusal.Absolute)
    expect(worktreePatternRefusal('a/../../x')).toBe(EWorktreePatternRefusal.ParentSegment)
    expect(worktreePatternRefusal('.')).toBe(EWorktreePatternRefusal.RepositoryRoot)
    expect(worktreePatternRefusal('.git/config')).toBe(EWorktreePatternRefusal.GitMetadata)
    expect(worktreePatternRefusal('')).toBe(EWorktreePatternRefusal.Empty)
    expect(worktreePatternRefusal('apps/*/.env')).toBeUndefined()
  })
})

describe('readWorktreeFilesDocument', () => {
  it('reads copy and link entries and refuses unsafe ones', () => {
    const read = readWorktreeFilesDocument({ copy: ['./a/.env', '/abs'], link: ['.turbo/cache/'] })
    expect(read).toEqual({
      ok: true,
      config: {
        patterns: [
          { pattern: 'a/.env', mode: EWorktreeFileMode.Copy },
          { pattern: '.turbo/cache', mode: EWorktreeFileMode.Link },
        ],
        refused: [
          {
            entry: '/abs',
            mode: EWorktreeFileMode.Copy,
            refusal: EWorktreePatternRefusal.Absolute,
          },
        ],
      },
    })
  })

  it('treats an empty document as nothing listed', () => {
    expect(readWorktreeFilesDocument(null)).toEqual({
      ok: true,
      config: { patterns: [], refused: [] },
    })
  })

  it('fails naming a path listed in both lists', () => {
    const read = readWorktreeFilesDocument({ copy: ['x'], link: ['./x'] })
    expect(read).toEqual({ ok: false, error: '"x" is listed under both copy and link' })
  })

  it('fails on unknown keys and wrong types', () => {
    expect(readWorktreeFilesDocument({ copies: ['x'] }).ok).toBe(false)
    expect(readWorktreeFilesDocument({ copy: 'x' }).ok).toBe(false)
  })
})

describe('planWorktreeFiles', () => {
  const copy = (path: string) => ({ path, mode: EWorktreeFileMode.Copy })
  const link = (path: string) => ({ path, mode: EWorktreeFileMode.Link })

  it('skips tracked files and directories holding tracked files', () => {
    const plan = planWorktreeFiles({
      matches: [copy('.env'), copy('src'), copy('README.md'), copy('.env')],
      tracked: ['README.md', 'src/index.ts'],
    })
    expect(plan).toEqual({
      ok: true,
      actions: [copy('.env')],
      tracked: [copy('src'), copy('README.md')],
    })
  })

  it('fails when one path is matched by both lists', () => {
    expect(planWorktreeFiles({ matches: [copy('a/.env'), link('a/.env')], tracked: [] })).toEqual({
      ok: false,
      conflicts: ['a/.env'],
    })
  })
})

describe('describeWorktreeFiles', () => {
  it('says nothing when the file is absent', () => {
    expect(describeWorktreeFiles({ state: EWorktreeFilesState.Absent })).toBeUndefined()
  })

  it('reports an invalid file', () => {
    expect(
      describeWorktreeFiles({
        state: EWorktreeFilesState.Invalid,
        file: '.atlas/worktree.yaml',
        error: 'bad',
      }),
    ).toBe('.atlas/worktree.yaml was not applied, so no files were copied or linked: bad.')
  })

  it('lists every outcome', () => {
    const text = describeWorktreeFiles({
      state: EWorktreeFilesState.Applied,
      file: '.atlas/worktree.yaml',
      source: '/repo',
      result: {
        copied: ['a/.env.keys'],
        linked: ['.turbo/cache'],
        skipped: [
          { path: 'b', mode: EWorktreeFileMode.Copy, skip: EWorktreeFileSkip.Present },
          { path: 'c', mode: EWorktreeFileMode.Copy, skip: EWorktreeFileSkip.Tracked },
        ],
        missing: ['apps/*/.env.local'],
        refused: [
          {
            entry: '../x',
            mode: EWorktreeFileMode.Copy,
            refusal: EWorktreePatternRefusal.ParentSegment,
          },
        ],
        failed: [],
      },
    })
    expect(text).toBe(
      '.atlas/worktree.yaml from /repo: copied a/.env.keys; linked .turbo/cache; skipped b (already present), c (tracked by git); missing (no match) apps/*/.env.local; refused ../x (contains ..).',
    )
  })
})

describe('planWorktreeFiles nesting', () => {
  it('keeps only the outermost of nested matches', () => {
    const copy = (path: string) => ({ path, mode: EWorktreeFileMode.Copy })
    expect(
      planWorktreeFiles({ matches: [copy('a'), copy('a/b'), copy('a/b/c')], tracked: [] }),
    ).toEqual({
      ok: true,
      actions: [copy('a')],
      tracked: [],
    })
  })
})

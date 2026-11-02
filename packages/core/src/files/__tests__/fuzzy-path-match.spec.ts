import { describe, expect, it } from 'bun:test'

import { fuzzyPathMatch, rankPaths } from '../fuzzy-path-match'

describe('fuzzyPathMatch', () => {
  it('returns null for an empty or whitespace query', () => {
    expect(fuzzyPathMatch({ query: '', path: 'a.ts' })).toBeNull()
    expect(fuzzyPathMatch({ query: '  ', path: 'a.ts' })).toBeNull()
  })

  it('returns null when the characters are not a subsequence', () => {
    expect(fuzzyPathMatch({ query: 'zzz', path: 'src/app.ts' })).toBeNull()
    expect(fuzzyPathMatch({ query: 'tsa', path: 'app.ts' })).toBeNull()
  })

  it('matches case-insensitively and reports positions', () => {
    const match = fuzzyPathMatch({ query: 'APP', path: 'src/app.ts' })
    expect(match?.positions).toEqual([4, 5, 6])
  })

  it('matches across directories when the basename alone cannot', () => {
    const match = fuzzyPathMatch({ query: 'srcapp', path: 'src/app.ts' })
    expect(match?.positions).toEqual([0, 1, 2, 4, 5, 6])
  })

  it('scores a basename match above a directory-only match', () => {
    const basename = fuzzyPathMatch({ query: 'tab', path: 'a/b/tab.ts' })
    const directory = fuzzyPathMatch({ query: 'tab', path: 'tab/x/y.ts' })
    expect(basename?.score).toBeGreaterThan(directory?.score ?? 0)
  })

  it('scores consecutive runs above scattered matches', () => {
    const run = fuzzyPathMatch({ query: 'form', path: 'form.ts' })
    const scattered = fuzzyPathMatch({ query: 'form', path: 'f-o-r-m.ts' })
    expect(run?.score).toBeGreaterThan(scattered?.score ?? 0)
  })

  it('scores segment starts above mid-word hits', () => {
    const start = fuzzyPathMatch({ query: 'ft', path: 'file-tree.ts' })
    const middle = fuzzyPathMatch({ query: 'ft', path: 'afatter.ts' })
    expect(start?.score).toBeGreaterThan(middle?.score ?? 0)
  })

  it('prefers a basename prefix', () => {
    const prefix = fuzzyPathMatch({ query: 'tree', path: 'tree-view.ts' })
    const inside = fuzzyPathMatch({ query: 'tree', path: 'file-tree.ts' })
    expect(prefix?.score).toBeGreaterThan(inside?.score ?? 0)
  })
})

describe('rankPaths', () => {
  const paths = ['src/app.ts', 'src/application/index.ts', 'docs/readme.md', 'app.ts']

  it('orders the best match first and drops non-matches', () => {
    const { matches } = rankPaths({ query: 'app.ts', paths, limit: 10 })
    expect(matches.map((match) => match.path)).toEqual([
      'app.ts',
      'src/app.ts',
      'src/application/index.ts',
    ])
  })

  it('caps at the limit and says so', () => {
    const { matches, truncated } = rankPaths({ query: 'a', paths, limit: 2 })
    expect(matches).toHaveLength(2)
    expect(truncated).toBe(true)
  })

  it('is not truncated when everything fits', () => {
    expect(rankPaths({ query: 'readme', paths, limit: 5 }).truncated).toBe(false)
  })

  it('breaks score ties by path', () => {
    const tied = rankPaths({ query: 'x', paths: ['b/x', 'a/x'], limit: 5 })
    expect(tied.matches.map((match) => match.path)).toEqual(['a/x', 'b/x'])
  })
})

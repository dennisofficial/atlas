import { describe, expect, it } from 'bun:test'

import { parseLineSuffix, pathMentions, resolveMentionAgainst } from '../path-mentions'

describe('pathMentions', () => {
  it('finds a bare filename with a known extension, with and without a line', () => {
    expect(pathMentions('see link-click.ts:42')[0]).toEqual({
      text: 'link-click.ts:42',
      path: 'link-click.ts',
      line: 42,
    })
    expect(pathMentions('edit package.json please')[0]).toEqual({
      text: 'package.json',
      path: 'package.json',
    })
  })

  it('finds slash-joined and absolute paths, extension-free, with line and column', () => {
    expect(pathMentions('in apps/tui/src/inline.ts:10:5 there')[0]).toEqual({
      text: 'apps/tui/src/inline.ts:10:5',
      path: 'apps/tui/src/inline.ts',
      line: 10,
    })
    expect(pathMentions('at /Users/d/atlas/bun.lockb:1')[0]).toEqual({
      text: '/Users/d/atlas/bun.lockb:1',
      path: '/Users/d/atlas/bun.lockb',
      line: 1,
    })
    expect(pathMentions('see ./rel/path.ts:3')[0]).toEqual({
      text: './rel/path.ts:3',
      path: './rel/path.ts',
      line: 3,
    })
  })

  it('matches extension-free slash-joined words, leaving the truth call to the resolver', () => {
    expect(pathMentions('the same foundation/structure/etc to services')[0]).toEqual({
      text: 'foundation/structure/etc',
      path: 'foundation/structure/etc',
    })
    expect(pathMentions('any recovery/reconciliation for them')[0]).toEqual({
      text: 'recovery/reconciliation',
      path: 'recovery/reconciliation',
    })
  })

  it('leaves times, plain words and URLs alone', () => {
    expect(pathMentions('at 12:30 and 12:30:45')).toEqual([])
    expect(pathMentions('a:b or foo')).toEqual([])
    expect(pathMentions('word wrap package.json5 nope')).toEqual([])
    expect(pathMentions('a url https://x.com/a.ts:9 end')).toEqual([])
  })

  it('never matches an @-mention or the path inside an HTML closing tag', () => {
    expect(pathMentions('why is @src/mentionable.ts broken')).toEqual([])
    expect(pathMentions('<summary>An html block</summary>')).toEqual([])
    expect(pathMentions('</details>')).toEqual([])
  })
})

describe('parseLineSuffix', () => {
  it('splits a trailing line and drops the column', () => {
    expect(parseLineSuffix('a/b.ts:10:5')).toEqual({ path: 'a/b.ts', line: 10 })
    expect(parseLineSuffix('a/b.ts:10')).toEqual({ path: 'a/b.ts', line: 10 })
    expect(parseLineSuffix('a/b.ts')).toEqual({ path: 'a/b.ts' })
  })
})

describe('resolveMentionAgainst', () => {
  const home = '/home/d'

  it('stands absolutes alone, expands home, and joins relatives onto the root', () => {
    expect(resolveMentionAgainst({ mention: '/etc/hosts', root: '/proj', home })).toBe('/etc/hosts')
    expect(resolveMentionAgainst({ mention: '~/x/y', root: '/proj', home })).toBe('/home/d/x/y')
    expect(resolveMentionAgainst({ mention: 'apps/tui/a.ts', root: '/proj', home })).toBe(
      '/proj/apps/tui/a.ts',
    )
    expect(resolveMentionAgainst({ mention: './a.ts', root: '/proj/', home })).toBe('/proj/./a.ts')
  })
})

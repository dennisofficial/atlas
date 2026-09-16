import { describe, expect, it } from 'bun:test'

import { compactPath, tailOfPath } from '../paths'

describe('tailOfPath', () => {
  it('leaves a path that already fits', () => {
    expect(tailOfPath({ path: '~/dev/atlas', cells: 20 })).toBe('~/dev/atlas')
  })

  it('drops leading segments to fit', () => {
    const tail = tailOfPath({ path: '~/dev/work/comp/atlas', cells: 14 })
    expect(tail).toBe('…/comp/atlas')
    expect([...tail].length).toBeLessThanOrEqual(14)
  })

  it('cuts to a segment boundary rather than mid-name', () => {
    expect(tailOfPath({ path: '~/dev/work/atlas', cells: 12 })).toBe('…/work/atlas')
  })

  it('falls back to the bare tail when no boundary fits', () => {
    expect(tailOfPath({ path: '~/averyverylongdirectory', cells: 8 })).toBe('…rectory')
  })
})

describe('compactPath', () => {
  it('leaves a path that already fits', () => {
    expect(compactPath({ path: '~/dev/atlas', cells: 20 })).toBe('~/dev/atlas')
  })

  it('shortens leading segments from the left until it fits', () => {
    expect(
      compactPath({ path: '~/Developer/comp-v3/.claude/worktrees/portal-auth-url', cells: 30 }),
    ).toBe('~/D/c/.c/w/portal-auth-url')
  })

  it('stops shortening as soon as the path fits', () => {
    expect(compactPath({ path: '~/Developer/comp-v3/apps/portal', cells: 24 })).toBe(
      '~/D/comp-v3/apps/portal',
    )
  })

  it('keeps the dot on a dotfile segment', () => {
    expect(compactPath({ path: '~/dev/.config/nvim/init.lua', cells: 18 })).toBe(
      '~/d/.c/n/init.lua',
    )
  })

  it('keeps the last segment whole', () => {
    const shown = compactPath({ path: '/srv/one/two/three/deployment', cells: 16 })
    expect(shown.endsWith('deployment')).toBe(true)
  })

  it('falls back to a tail when even the shortest form overflows', () => {
    const shown = compactPath({ path: '~/a/b/c/anextremelylongdirectoryname', cells: 12 })
    expect([...shown].length).toBeLessThanOrEqual(12)
    expect(shown.startsWith('…')).toBe(true)
  })
})

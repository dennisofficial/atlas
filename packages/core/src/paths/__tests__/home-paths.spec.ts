import { describe, expect, it } from 'bun:test'

import { collapseHome, expandHome } from '../home-paths'

const HOME = '/Users/ada'

describe('collapseHome', () => {
  it('answers ~ for the home directory itself', () => {
    expect(collapseHome({ cwd: HOME, home: HOME })).toBe('~')
  })

  it('collapses a path under home', () => {
    expect(collapseHome({ cwd: `${HOME}/dev/atlas`, home: HOME })).toBe('~/dev/atlas')
  })

  it('leaves a path outside home alone', () => {
    expect(collapseHome({ cwd: '/etc/hosts', home: HOME })).toBe('/etc/hosts')
  })

  it('leaves a sibling of home alone', () => {
    expect(collapseHome({ cwd: '/Users/adaline', home: HOME })).toBe('/Users/adaline')
  })

  it('leaves everything alone when there is no home', () => {
    expect(collapseHome({ cwd: '/srv/atlas', home: '' })).toBe('/srv/atlas')
  })
})

describe('expandHome', () => {
  it('answers the home directory for a bare ~', () => {
    expect(expandHome({ path: '~', home: HOME })).toBe(HOME)
  })

  it('expands a path under ~', () => {
    expect(expandHome({ path: '~/dev/atlas', home: HOME })).toBe(`${HOME}/dev/atlas`)
  })

  it('leaves a ~ that does not start a segment alone', () => {
    expect(expandHome({ path: '~atlas', home: HOME })).toBe('~atlas')
    expect(expandHome({ path: '/srv/~/atlas', home: HOME })).toBe('/srv/~/atlas')
  })

  it('leaves everything alone when there is no home', () => {
    expect(expandHome({ path: '~/dev/atlas', home: '' })).toBe('~/dev/atlas')
  })
})

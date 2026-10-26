import { describe, expect, test } from 'bun:test'

import { matchRoute, patternMatchesPath } from '../route-samples'

const SAMPLES = {
  '/threads/[threadId]': [
    { label: 'Session', path: '/threads/thr-1' },
    { label: 'Teammate', path: '/threads/tm-1' },
  ],
  '/settings/[page]': [{ label: 'Account', path: '/settings/account' }],
  '/projects/[projectId]/settings/[section]': [
    { label: 'Overview', path: '/projects/rs-crm/settings/overview' },
  ],
}

describe('patternMatchesPath', () => {
  test('dynamic segments match any single segment', () => {
    expect(patternMatchesPath({ pattern: '/threads/[threadId]', pathname: '/threads/abc' })).toBe(
      true,
    )
    expect(patternMatchesPath({ pattern: '/threads/[threadId]', pathname: '/threads' })).toBe(false)
    expect(patternMatchesPath({ pattern: '/threads/[threadId]', pathname: '/threads/a/b' })).toBe(
      false,
    )
    expect(patternMatchesPath({ pattern: '/threads/[threadId]', pathname: '/other/abc' })).toBe(
      false,
    )
  })

  test('ignores the query string', () => {
    expect(
      patternMatchesPath({ pattern: '/threads/[threadId]', pathname: '/threads/abc?tab=files' }),
    ).toBe(true)
  })
})

describe('matchRoute', () => {
  test('returns the pattern, its samples and the current sample', () => {
    const match = matchRoute({ path: '/threads/tm-1?state=idle', samples: SAMPLES })
    expect(match?.pattern).toBe('/threads/[threadId]')
    expect(match?.samples).toHaveLength(2)
    expect(match?.current?.label).toBe('Teammate')
  })

  test('has no current sample for a path outside the sample list', () => {
    const match = matchRoute({ path: '/threads/unknown', samples: SAMPLES })
    expect(match?.pattern).toBe('/threads/[threadId]')
    expect(match?.current).toBeNull()
  })

  test('matches nested patterns', () => {
    const match = matchRoute({ path: '/projects/rs-crm/settings/overview', samples: SAMPLES })
    expect(match?.pattern).toBe('/projects/[projectId]/settings/[section]')
  })

  test('returns null for static routes', () => {
    expect(matchRoute({ path: '/settings', samples: SAMPLES })).toBeNull()
    expect(matchRoute({ path: '/', samples: SAMPLES })).toBeNull()
  })
})

describe('static routes win over dynamic ones', () => {
  const STATIC_PATHS = new Set(['/threads/new'])

  test('a static sibling does not match the dynamic pattern', () => {
    expect(
      patternMatchesPath({
        pattern: '/threads/[threadId]',
        pathname: '/threads/new',
        staticPaths: STATIC_PATHS,
      }),
    ).toBe(false)
  })

  test('other ids still match the dynamic pattern', () => {
    expect(
      patternMatchesPath({
        pattern: '/threads/[threadId]',
        pathname: '/threads/thr-1',
        staticPaths: STATIC_PATHS,
      }),
    ).toBe(true)
  })

  test('matchRoute gives a static sibling no route samples', () => {
    expect(
      matchRoute({ path: '/threads/new', samples: SAMPLES, staticPaths: STATIC_PATHS }),
    ).toBeNull()
  })
})

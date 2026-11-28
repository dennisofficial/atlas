import { describe, expect, it } from 'bun:test'
import { createGithubBrowserReturn, GITHUB_RETURN_COPY } from '../github-browser-return'

const url = 'https://api.byatlas.io/return/start/github-helper-state'

describe('GitHub browser return fallback', () => {
  it('falls back when the browser cannot launch', async () => {
    const abandoned = Promise.withResolvers<void>()
    const opener = createGithubBrowserReturn({
      generation: { current: 1 },
      fallback: { current: () => abandoned.resolve() },
    })
    opener.open({ url, open: () => false, copy: GITHUB_RETURN_COPY })
    await abandoned.promise
    opener.stop()
  })

  it('does not fall back when the owner cancels an attempt', async () => {
    const generation = { current: 1 }
    let fallbacks = 0
    const opener = createGithubBrowserReturn({
      generation,
      fallback: {
        current: () => {
          fallbacks++
        },
      },
    })
    let href = ''
    opener.open({
      url,
      open: (opened) => {
        href = opened
      },
      copy: GITHUB_RETURN_COPY,
    })
    expect(new URL(href).searchParams.get('surface')).toBe('tui')
    expect(new URL(href).searchParams.get('port')).not.toBeNull()
    generation.current++
    opener.stop()
    await Promise.resolve()
    expect(fallbacks).toBe(0)
  })
})

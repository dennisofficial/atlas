import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ERepoTracking } from '@dltech/atlas-wire/web'

import { RepoTrackingCard } from '../repo-tracking-card'

const html = renderToStaticMarkup(
  <RepoTrackingCard
    repos={[
      { repo: 'compai/app', branch: 'main', tracking: ERepoTracking.App },
      { repo: 'compai/hooked', tracking: ERepoTracking.User },
      { repo: 'compai/loose', branch: 'release', tracking: ERepoTracking.Polled },
    ]}
  />,
)

describe('RepoTrackingCard', () => {
  it('names the repo, its branch and the transport in force for every binding', () => {
    expect(html).toContain('compai/app')
    expect(html).toContain('main')
    expect(html).toContain('App webhook')
    expect(html).toContain('compai/hooked')
    expect(html).toContain('User webhook')
    expect(html).toContain('Polled — refreshes every 60s while open')
  })

  it('reports the state without offering a control', () => {
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('type="checkbox"')
  })
})

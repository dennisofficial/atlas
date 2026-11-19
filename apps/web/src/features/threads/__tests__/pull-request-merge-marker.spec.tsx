import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { PullRequestMergeMarker, mergeMarkerOf } from '../pull-request-merge-marker'

const entry = (overrides: { state?: string; mergeQueued?: boolean; autoMerge?: boolean } = {}) => ({
  state: 'open',
  ...overrides,
})

describe('PullRequestMergeMarker', () => {
  it('shows no marker while queued, even when auto-merge is also on', () => {
    const html = renderToStaticMarkup(
      <PullRequestMergeMarker entry={entry({ mergeQueued: true, autoMerge: true })} />,
    )

    expect(html).toBe('')
  })

  it('shows the auto-merge marker as an icon only, named by its hint', () => {
    const html = renderToStaticMarkup(<PullRequestMergeMarker entry={entry({ autoMerge: true })} />)

    expect(html).toContain('lucide-fast-forward')
    expect(html).toContain('aria-label="Auto-merge enabled"')
    expect(html).not.toContain('>Auto-merge<')
  })

  it('hides the marker for a merged or closed pull request and when neither flag is set', () => {
    expect(mergeMarkerOf(entry({ state: 'merged', mergeQueued: true }))).toBeUndefined()
    expect(mergeMarkerOf(entry({ state: 'closed', autoMerge: true }))).toBeUndefined()
    expect(mergeMarkerOf(entry())).toBeUndefined()
  })

  it('hints at the wait the auto-merge marker stands for', () => {
    expect(mergeMarkerOf(entry({ autoMerge: true }))).toEqual({
      icon: expect.anything(),
      hint: 'Auto-merge enabled',
    })
  })
})

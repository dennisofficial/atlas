import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { PullRequestMergeMarker, mergeMarkerOf } from '../pull-request-merge-marker'

const entry = (overrides: { state?: string; mergeQueued?: boolean; autoMerge?: boolean } = {}) => ({
  state: 'open',
  ...overrides,
})

describe('PullRequestMergeMarker', () => {
  it('shows the queue marker even when auto-merge is also on', () => {
    const html = renderToStaticMarkup(
      <PullRequestMergeMarker entry={entry({ mergeQueued: true, autoMerge: true })} />,
    )

    expect(html).toContain('Queued')
    expect(html).toContain('lucide-list-ordered')
    expect(html).not.toContain('Auto-merge')
  })

  it('shows the auto-merge marker when only the setting is on', () => {
    const html = renderToStaticMarkup(<PullRequestMergeMarker entry={entry({ autoMerge: true })} />)

    expect(html).toContain('Auto-merge')
    expect(html).toContain('lucide-zap')
    expect(html).not.toContain('Queued')
  })

  it('hides the marker for a merged or closed pull request and when neither flag is set', () => {
    expect(mergeMarkerOf(entry({ state: 'merged', mergeQueued: true }))).toBeUndefined()
    expect(mergeMarkerOf(entry({ state: 'closed', autoMerge: true }))).toBeUndefined()
    expect(mergeMarkerOf(entry())).toBeUndefined()
  })

  it('hints at the wait each marker stands for', () => {
    expect(mergeMarkerOf(entry({ mergeQueued: true }))).toMatchObject({
      label: 'Queued',
      hint: 'In merge queue',
    })
    expect(mergeMarkerOf(entry({ autoMerge: true }))).toMatchObject({
      label: 'Auto-merge',
      hint: 'Auto-merge enabled',
    })
  })
})

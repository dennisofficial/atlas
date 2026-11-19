import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { PullRequestEntry } from '@/features/threads/data/pull-request-entries'
import { PullRequestIcon } from '../thread-pr-presentation'

const entry = (overrides: Partial<PullRequestEntry>): PullRequestEntry =>
  ({
    repo: 'o/r',
    number: 1,
    url: '',
    branch: 'b',
    state: 'open',
    ...overrides,
  }) as PullRequestEntry

describe('PullRequestIcon', () => {
  it('turns the icon the queued colour while the pull request is in the merge queue', () => {
    const html = renderToStaticMarkup(<PullRequestIcon entry={entry({ mergeQueued: true })} />)

    expect(html).toContain('text-pr-queued')
    expect(html).toContain('Pull request queued')
  })

  it('keeps the state colour once the pull request merged', () => {
    const html = renderToStaticMarkup(
      <PullRequestIcon entry={entry({ state: 'merged', mergeQueued: true })} />,
    )

    expect(html).toContain('text-pr-merged')
    expect(html).not.toContain('text-pr-queued')
  })
})

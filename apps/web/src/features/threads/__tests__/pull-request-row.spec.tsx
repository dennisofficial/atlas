import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EPullRequestStateWire } from '@dltech/atlas-wire/web'

import type { PullRequestRow } from '../data/pull-request-rows'
import { PullRequestRowItem } from '../panel/details/pull-request-row'

const row = (over: Partial<PullRequestRow> = {}): PullRequestRow => ({
  key: 'o/r#1',
  label: '#1',
  url: 'https://github.com/o/r/pull/1',
  branch: 'dennis/fix',
  state: EPullRequestStateWire.Open,
  checks: undefined,
  conflicts: false,
  polled: false,
  via: undefined,
  ...over,
})

const render = (over: Partial<PullRequestRow> = {}) =>
  renderToStaticMarkup(
    <PullRequestRowItem row={row(over)} bell={undefined} onToggleBell={() => undefined} />,
  )

describe('PullRequestRowItem polled marker', () => {
  it('says polled when the wire reports a poll-backed pull request', () => {
    expect(render({ polled: true })).toContain('>polled<')
  })

  it('says nothing when the wire reports a webhook-backed pull request', () => {
    expect(render()).not.toContain('polled')
  })
})

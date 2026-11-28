import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EPullRequestStateWire } from '@dltech/atlas-wire/web'

import type { PullRequestRow } from '../data/pull-request-rows'
import { EPullRequestRowLayout, PullRequestRowItem } from '../panel/details/pull-request-row'
import { ROW_SURFACE } from '@/features/sessions/panel/details/rows'

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
  renderToStaticMarkup(<PullRequestRowItem row={row(over)} />)

describe('PullRequestRowItem card layout', () => {
  it('uses one rounded ghost surface for the title and branch', () => {
    const html = renderToStaticMarkup(
      <PullRequestRowItem
        row={row()}
        layout={EPullRequestRowLayout.Row}
        bell={<button type="button">Bell</button>}
      />,
    )
    expect(html).toContain(ROW_SURFACE)
    expect(html).toContain('data-pane-row')
    expect(html).toContain('dennis/fix')
    expect(html).toContain('group-hover:hidden')
    expect(html).toContain('group-hover:flex')
    expect(html).not.toContain('<td')
    expect(html).not.toContain('border-b')
  })

  it('keeps the default table layout for other consumers', () => {
    expect(render()).toContain('<tr')
    expect(render()).toContain('<td')
  })
})

describe('PullRequestRowItem conflicts', () => {
  it('shows the warning triangle when the pull request has merge conflicts', () => {
    expect(render({ conflicts: true })).toContain('aria-label="Merge conflicts"')
  })

  it('shows no triangle without conflicts', () => {
    expect(render()).not.toContain('Merge conflicts')
  })
})

describe('PullRequestRowItem polled marker', () => {
  it('says polled when the wire reports a poll-backed pull request', () => {
    expect(render({ polled: true })).toContain('>polled<')
  })

  it('says nothing when the wire reports a webhook-backed pull request', () => {
    expect(render()).not.toContain('polled')
  })
})

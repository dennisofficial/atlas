import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SessionDetailsHeader } from '../details/header-section'
import { SessionPaneProvider, type SessionPaneValue } from '../pane-value'
import { paneValueFixture, spendFixture, viewModelFixture } from './fixture'

const render = (value: SessionPaneValue): string =>
  renderToStaticMarkup(
    <SessionPaneProvider value={value}>
      <SessionDetailsHeader />
    </SessionPaneProvider>,
  )

const textOf = (html: string): string => html.replace(/<[^>]+>/g, '')

const emptySpend = {
  inputTokens: 0,
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: null,
}

describe('SessionDetailsHeader', () => {
  it('fits spend, time, tokens and cache on two lines', () => {
    const html = render(
      paneValueFixture({
        view: viewModelFixture({
          spend: spendFixture,
          compute: { costUsd: 0.28, running: false, tick: null },
        }),
      }),
    )
    const text = textOf(html)
    expect(html).toContain('data-session-summary')
    expect(html).toContain('data-session-spend')
    expect(html.match(/justify-between/g)?.length).toBe(2)
    expect(text).toContain('$0.50 spent')
    expect(text).toContain('$0.28 sandbox')
    expect(text).toMatch(/\d+h \d+m running/)
    expect(text).toContain('2.0k in')
    expect(text).toContain('1.2k out')
    expect(text).toContain('50% cached')
    expect(html).toContain('title="Input tokens"')
    expect(html).toContain('title="2.0k tokens read from cache"')
    expect(html).not.toContain('\u00b7')
    expect(text.indexOf('spent')).toBeLessThan(text.indexOf(' in'))
  })

  it('omits missing prices while keeping token stats', () => {
    const text = textOf(
      render(
        paneValueFixture({
          startedAt: undefined,
          view: viewModelFixture({ spend: { ...spendFixture, costUsd: null } }),
        }),
      ),
    )
    expect(text).not.toContain('spent')
    expect(text).not.toContain('running')
    expect(text).toContain('2.0k in')
    expect(text).toContain('50% cached')
  })

  it('omits the token line before the first tokens, but shows a known zero cost', () => {
    const text = textOf(
      render(
        paneValueFixture({ view: viewModelFixture({ spend: { ...emptySpend, costUsd: 0 } }) }),
      ),
    )
    expect(text).toContain('$0.00 spent')
    expect(text).not.toContain(' in')
    expect(text).not.toContain('cached')
  })

  it('keeps sandbox spend visible before model spend is available', () => {
    const text = textOf(
      render(
        paneValueFixture({
          startedAt: undefined,
          view: viewModelFixture({ compute: { costUsd: 0.28, running: false, tick: null } }),
        }),
      ),
    )
    expect(text).toContain('$0.28 sandbox')
    expect(text).not.toContain(' in')
  })

  it('renders nothing when every stat is missing', () => {
    expect(render(paneValueFixture({ startedAt: undefined }))).toBe('')
    expect(render(paneValueFixture({ startedAt: 'invalid' }))).toBe('')
    expect(
      render(
        paneValueFixture({
          startedAt: undefined,
          view: viewModelFixture({ spend: emptySpend }),
        }),
      ),
    ).toBe('')
  })
})

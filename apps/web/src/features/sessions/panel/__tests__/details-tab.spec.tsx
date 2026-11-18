import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SessionDetailsTab } from '../details-tab'
import { SessionPaneProvider, type SessionPaneValue } from '../pane-value'
import { paneValueFixture, populatedPaneValue } from './fixture'

const render = (value: SessionPaneValue): string =>
  renderToStaticMarkup(
    <SessionPaneProvider value={value}>
      <SessionDetailsTab />
    </SessionPaneProvider>,
  )

describe('SessionDetailsTab', () => {
  it('reads every section from the streamed view', () => {
    const html = render(populatedPaneValue())
    expect(html).toContain('Running')
    expect(html).toContain('dennis/v2-session-pane')
    expect(html).toContain('1.2k / 200.0k')
    expect(html).toContain('$0.50 spent')
    expect(html).toContain('2.0k in · 1.2k out')
    expect(html).toContain('2.0k cached')
    expect(html).toContain('aria-label="GitHub"')
    expect(html).toContain('main → dennis/v2-session-pane')
    expect(html).toContain('href="https://github.com/owner/atlas/pull/7"')
    expect(html).toContain('Add the session pane')
    expect(html).toContain('aria-label="Services"')
    expect(html).toContain('https://4321-abc.byatlas.dev')
    expect(html).toContain('aria-label="Shells"')
    expect(html).toContain('tick 1')
    expect(html).toContain('aria-label="Sub-agents"')
    expect(html).toContain('work the branch')
    expect(html).toContain('map the seam')
    expect(html).toContain('aria-label="Subscriptions"')
    expect(html).toContain('href="https://github.com/owner/atlas/pull/31"')
  })

  it('renders only the summary when the view carries nothing else', () => {
    const html = render(paneValueFixture())
    expect(html).toContain('data-session-summary')
    expect(html).not.toContain('aria-label="GitHub"')
    expect(html).not.toContain('aria-label="Services"')
    expect(html).not.toContain('aria-label="Shells"')
    expect(html).not.toContain('aria-label="Sub-agents"')
    expect(html).not.toContain('aria-label="Subscriptions"')
  })
})

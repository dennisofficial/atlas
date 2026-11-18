import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { SessionPane } from '../session-pane'
import { ESessionPaneTab, PANE_TAB_LABEL } from '../pane-tab'
import { SessionPaneProvider } from '../pane-value'
import { paneValueFixture, populatedPaneValue } from './fixture'

const render = (tab: ESessionPaneTab, value = populatedPaneValue()): string =>
  renderToStaticMarkup(
    <SessionPaneProvider value={value}>
      <SessionPane tab={tab} onTabChange={() => undefined} />
    </SessionPaneProvider>,
  )

describe('SessionPane', () => {
  it('lists the five tabs in order', () => {
    const html = render(ESessionPaneTab.Details)
    const positions = Object.values(PANE_TAB_LABEL).map((label) => html.indexOf(`>${label}`))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('renders the details of the streamed view on the Details tab', () => {
    const html = render(ESessionPaneTab.Details)
    expect(html).toContain('data-session-summary')
    expect(html).toContain('dennis/v2-session-pane')
  })

  it('tells the Terminal tab owner what is missing, without the details', () => {
    const html = render(ESessionPaneTab.Terminal)
    expect(html).toContain('Terminal is not connected')
    expect(html).not.toContain('data-session-summary')
  })

  it('renders the empty state on every tab the stream cannot fill yet', () => {
    for (const tab of [ESessionPaneTab.Changes, ESessionPaneTab.Files, ESessionPaneTab.Browser]) {
      expect(render(tab)).toContain(`data-pane-empty="${tab}"`)
    }
  })

  it('renders without a view, on a session that has streamed nothing', () => {
    expect(render(ESessionPaneTab.Details, paneValueFixture())).toContain(
      'Context not measured yet',
    )
  })
})

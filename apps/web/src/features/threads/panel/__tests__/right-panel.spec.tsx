import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { RightPanel } from '../right-panel'
import { ERightTab, isRightTab, TAB_LABEL } from '../right-tab'

const render = (tab: ERightTab): string =>
  renderToStaticMarkup(<RightPanel tab={tab} onTabChange={() => undefined} />)

describe('RightPanel', () => {
  it('lists the five tabs in prototype order', () => {
    const html = render(ERightTab.Agents)
    const positions = Object.values(TAB_LABEL).map((label) => html.indexOf(`>${label}<`))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it.each(Object.values(ERightTab))('renders the placeholder body for %s', (tab) => {
    expect(render(tab)).toContain('data-slot="empty"')
  })
})

describe('isRightTab', () => {
  it('accepts tab values and rejects anything else', () => {
    expect(isRightTab('changes')).toBe(true)
    expect(isRightTab('nope')).toBe(false)
    expect(isRightTab(undefined)).toBe(false)
  })
})

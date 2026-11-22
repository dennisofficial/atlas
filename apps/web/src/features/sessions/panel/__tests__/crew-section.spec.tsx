import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { ThreadPanelProvider } from '@/features/threads/panel/thread-panel-context'

import { panelValueOf } from '../../data/panel-value'
import { SessionCrewSection } from '../details/crew-section'
import { SessionPaneProvider } from '../pane-value'
import { populatedPaneValue } from './fixture'

const sectionWith = (openAgent: (agentId: string) => void) => (
  <ThreadPanelProvider
    value={panelValueOf({
      sessionId: 'ses-1',
      working: false,
      agentId: undefined,
      openAgent,
      clearAgent: () => undefined,
    })}
  >
    <SessionPaneProvider value={populatedPaneValue()}>
      <SessionCrewSection />
    </SessionPaneProvider>
  </ThreadPanelProvider>
)

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

describe('SessionCrewSection', () => {
  it('opens the clicked sub-agent from the Details list', async () => {
    const opened: string[] = []
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => root.render(sectionWith((agentId) => opened.push(agentId))))

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open the explore sub-agent: map the seam"]',
    )
    if (button === null) throw new Error('no sub-agent row button')
    await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(opened).toEqual(['agent-2'])
    await act(async () => root.unmount())
  })

  it('renders plain rows when no panel can open a sub-agent', () => {
    const html = renderToStaticMarkup(
      <SessionPaneProvider value={populatedPaneValue()}>
        <SessionCrewSection />
      </SessionPaneProvider>,
    )
    expect(html).toContain('map the seam')
    expect(html).not.toContain('<button type="button" data-pane-row')
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { EAgentStatus } from '@dltech/atlas-core'
import { orderedCrewRows } from '@dltech/atlas-plugin-crew/client'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { ThreadPanelProvider } from '@/features/threads/panel/thread-panel-context'

import { panelValueOf } from '../../data/panel-value'
import { SessionCrewSection } from '../details/crew-section'
import { SessionPaneProvider } from '../pane-value'
import { crewRowFixture, paneValueFixture, populatedPaneValue, viewModelFixture } from './fixture'

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
  it('keeps every active status visible before recent finished rows and expands the rest', async () => {
    const statuses = [
      EAgentStatus.Finished,
      EAgentStatus.Running,
      EAgentStatus.WaitingForModel,
      EAgentStatus.Blocked,
      EAgentStatus.Paused,
      EAgentStatus.Stopped,
    ]
    const crewRows = orderedCrewRows(
      statuses.map((status) =>
        crewRowFixture({
          agentId: status,
          agentType: status,
          status,
        }),
      ),
    )
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () =>
      root.render(
        <SessionPaneProvider
          value={paneValueFixture({
            view: viewModelFixture({ crewRows, crew: { running: 1, total: 6 } }),
          })}
        >
          <SessionCrewSection />
        </SessionPaneProvider>,
      ),
    )
    expect(container.querySelectorAll('[data-pane-row]')).toHaveLength(4)
    expect(container.textContent).toContain('1 running')
    expect(
      container.querySelector('.gap-2 > .text-foreground')?.nextElementSibling?.textContent,
    ).toBe('6')
    expect(container.querySelector('[aria-label="Paused"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Finished"]')).toBeNull()
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]')
    if (toggle === null) throw new Error('no crew fold toggle')
    expect(toggle.textContent).toBe('Show all (6)')
    await act(async () => toggle.click())
    expect(container.querySelectorAll('[data-pane-row]')).toHaveLength(6)
    expect(toggle.textContent).toBe('Show fewer')
    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await act(async () => root.unmount())
  })

  it('fills three folded rows when fewer than three are active', () => {
    const crewRows = orderedCrewRows([
      crewRowFixture({ agentId: 'active' }),
      ...Array.from({ length: 4 }, (_, index) =>
        crewRowFixture({
          agentId: `ended-${index}`,
          status: EAgentStatus.Finished,
        }),
      ),
    ])
    const html = renderToStaticMarkup(
      <SessionPaneProvider
        value={paneValueFixture({
          view: viewModelFixture({ crewRows, crew: { running: 1, total: 5 } }),
        })}
      >
        <SessionCrewSection />
      </SessionPaneProvider>,
    )
    expect(html.match(/data-pane-row/g)).toHaveLength(3)
    expect(html).toContain('Show all (5)')
  })

  it('shows only the total when there are no running sub-agents', () => {
    const html = renderToStaticMarkup(
      <SessionPaneProvider
        value={paneValueFixture({
          view: viewModelFixture({
            crewRows: [crewRowFixture({ status: EAgentStatus.Finished })],
            crew: { running: 0, total: 1 },
          }),
        })}
      >
        <SessionCrewSection />
      </SessionPaneProvider>,
    )
    expect(html).not.toContain(' running')
    expect(html).toContain('aria-label="Finished"')
  })

  it('renders nothing when there are no sub-agents', () => {
    expect(
      renderToStaticMarkup(
        <SessionPaneProvider value={paneValueFixture()}>
          <SessionCrewSection />
        </SessionPaneProvider>,
      ),
    ).toBe('')
  })
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

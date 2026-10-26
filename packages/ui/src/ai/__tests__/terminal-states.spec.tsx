import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  connectionLabel,
  ConnectionHeader,
  DisconnectedBar,
  ETerminalConnection,
  PausedNotice,
} from '../terminal-states'
import { TerminalPanel } from '../terminal-panel'
import { TerminalTabs } from '../terminal-tabs'

const { Connecting, Connected, Paused, Disconnected } = ETerminalConnection

describe('connectionLabel', () => {
  it('words each connection state around the noun', () => {
    expect(connectionLabel({ connection: Connecting, noun: 'pod' })).toBe('Connecting to pod…')
    expect(
      connectionLabel({
        connection: Connected,
        noun: 'pod',
        detail: '4 vCPU · 8 GB',
      }),
    ).toBe('Connected to pod · 4 vCPU · 8 GB')
    expect(connectionLabel({ connection: Paused, noun: 'pod' })).toBe('Pod paused')
    expect(connectionLabel({ connection: Disconnected, noun: 'sandbox' })).toBe(
      'Disconnected from sandbox',
    )
  })
})

describe('terminal chrome', () => {
  it('renders the header label', () => {
    expect(
      renderToStaticMarkup(<ConnectionHeader connection={Paused} detail="2 vCPU" />),
    ).toContain('Pod paused · 2 vCPU')
  })

  it('offers resume and reconnect actions', () => {
    expect(renderToStaticMarkup(<PausedNotice onResume={() => undefined} />)).toContain(
      'Resume pod',
    )
    const bar = renderToStaticMarkup(
      <DisconnectedBar onReconnect={() => undefined} message="The pod did not start." />,
    )
    expect(bar).toContain('Reconnect')
    expect(bar).toContain('The pod did not start.')
  })

  it('lists tabs and only shows the new-terminal action when handled', () => {
    const tabs = [
      { id: 'a', label: 'Terminal 1' },
      { id: 'b', label: 'Terminal 2' },
    ]
    const without = renderToStaticMarkup(
      <TerminalTabs tabs={tabs} activeId="a" onActiveChange={() => undefined} />,
    )
    expect(without).toContain('Terminal 2')
    expect(without).not.toContain('New terminal')
    const withNew = renderToStaticMarkup(
      <TerminalTabs
        tabs={tabs}
        activeId="a"
        onActiveChange={() => undefined}
        onNew={() => undefined}
      />,
    )
    expect(withNew).toContain('New terminal')
  })

  it('shows the screen only while connected or disconnected', () => {
    const render = (connection: ETerminalConnection) =>
      renderToStaticMarkup(
        <TerminalPanel
          connection={connection}
          tabs={[{ id: 'a', label: 'Terminal 1' }]}
          activeId="a"
          onActiveChange={() => undefined}
          onReconnect={() => undefined}
        >
          <div>screen-slot</div>
        </TerminalPanel>,
      )
    expect(render(Connected)).toContain('screen-slot')
    expect(render(Disconnected)).toContain('screen-slot')
    expect(render(Connecting)).not.toContain('screen-slot')
    expect(render(Paused)).not.toContain('screen-slot')
  })
})

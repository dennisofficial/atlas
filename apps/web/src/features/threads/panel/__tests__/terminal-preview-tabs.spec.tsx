import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EPodState, type PodStatus } from '@dltech/atlas-wire/web'

import { PreviewTab } from '../preview-tab'
import { TerminalTab } from '../terminal-tab'
import { ThreadPanelProvider, type ThreadPanelValue } from '../thread-panel-context'

const panel = (pod: PodStatus | null): ThreadPanelValue => ({
  threadId: 'thr_1',
  channel: null,
  pod,
  working: false,
  changesPath: undefined,
  agentId: undefined,
  openChanges: () => undefined,
  openAgent: () => undefined,
  clearAgent: () => undefined,
  closePanel: () => undefined,
  refreshPod: () => undefined,
})

const render = (args: { pod: PodStatus | null; body: React.ReactNode }): string =>
  renderToStaticMarkup(
    <ThreadPanelProvider value={panel(args.pod)}>{args.body}</ThreadPanelProvider>,
  )

describe('TerminalTab', () => {
  it('shows the paused notice for a parked pod', () => {
    const html = render({ pod: { state: EPodState.Parked, steps: [] }, body: <TerminalTab /> })
    expect(html).toContain('Pod paused')
    expect(html).toContain('Resume pod')
  })

  it('shows the connecting notice while the pod has no channel yet', () => {
    const html = render({ pod: { state: EPodState.Booting, steps: [] }, body: <TerminalTab /> })
    expect(html).toContain('Opening a shell')
  })

  it('shows the disconnected bar for a failed pod', () => {
    const html = render({ pod: { state: EPodState.Failed, steps: [] }, body: <TerminalTab /> })
    expect(html).toContain('Reconnect')
  })
})

describe('PreviewTab', () => {
  it('shows the empty state when nothing is exposed', () => {
    const html = render({ pod: null, body: <PreviewTab /> })
    expect(html).toContain('Nothing to preview')
  })
})

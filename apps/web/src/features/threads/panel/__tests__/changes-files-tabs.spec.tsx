import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EPodState } from '@dltech/atlas-wire/web'

import { ChangesTab } from '../changes-tab'
import { FilesTab } from '../files-tab'
import { ThreadPanelProvider, type ThreadPanelValue } from '../thread-panel-context'
import { EMPTY_DETAILS } from '../details/details-input'

const base: ThreadPanelValue = {
  threadId: 'thr_1',
  channel: null,
  loaded: true,
  error: null,
  pod: null,
  working: false,
  changesPath: undefined,
  agentId: undefined,
  openChanges: () => undefined,
  openAgent: () => undefined,
  openDetails: () => undefined,
  details: EMPTY_DETAILS,
  clearAgent: () => undefined,
  contextPath: undefined,
  openContextFile: () => undefined,
  closeContextFile: () => undefined,
  closePanel: () => undefined,
  refreshPod: () => undefined,
}

const render = (node: React.ReactNode, value: Partial<ThreadPanelValue> = {}): string =>
  renderToStaticMarkup(
    <ThreadPanelProvider value={{ ...base, ...value }}>{node}</ThreadPanelProvider>,
  )

describe('ChangesTab', () => {
  it('tells a parked pod owner the sandbox is asleep', () => {
    const html = render(<ChangesTab />, {
      pod: { state: EPodState.Parked, steps: [] },
    })
    expect(html).toContain('Sandbox is asleep')
  })

  it('shows the connecting empty state while the pod has no channel', () => {
    expect(render(<ChangesTab />)).toContain('Connecting to the pod')
  })
})

describe('FilesTab', () => {
  it('tells a parked pod owner the sandbox is asleep', () => {
    const html = render(<FilesTab />, {
      pod: { state: EPodState.Parked, steps: [] },
    })
    expect(html).toContain('Sandbox is asleep')
    expect(html).toContain('Files appear')
  })
})

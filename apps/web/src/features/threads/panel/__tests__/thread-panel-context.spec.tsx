import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ThreadPanelProvider, type ThreadPanelValue, useThreadPanel } from '../thread-panel-context'
import { EMPTY_DETAILS } from '../details/details-input'

const value: ThreadPanelValue = {
  threadId: 'thr_1',
  channel: null,
  pod: null,
  working: true,
  changesPath: undefined,
  agentId: undefined,
  openChanges: () => undefined,
  openAgent: () => undefined,
  openDetails: () => undefined,
  details: EMPTY_DETAILS,
  clearAgent: () => undefined,
  contextPath: undefined,
  openContextFile: () => undefined,
  toggleContextFile: () => undefined,
  closeContextFile: () => undefined,
  closePanel: () => undefined,
  refreshPod: () => undefined,
}

function Probe() {
  const panel = useThreadPanel()
  return <span>{`${panel.threadId}:${panel.working}`}</span>
}

describe('useThreadPanel', () => {
  it('reads the provided value', () => {
    const html = renderToStaticMarkup(
      <ThreadPanelProvider value={value}>
        <Probe />
      </ThreadPanelProvider>,
    )
    expect(html).toContain('thr_1:true')
  })

  it('throws outside the provider', () => {
    expect(() => renderToStaticMarkup(<Probe />)).toThrow('ThreadPanelProvider')
  })
})

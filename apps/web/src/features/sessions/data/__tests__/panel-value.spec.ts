import { describe, expect, it, mock } from 'bun:test'

import { EMPTY_DETAILS } from '@/features/threads/panel/details/details-input'

import { EPaneOpen } from '../../panel/pane-open'
import { ESessionPaneTab } from '../../panel/pane-tab'
import { panelValueOf } from '../panel-value'

const wiring = (
  overrides: {
    openTab?: (tab: ESessionPaneTab) => void
    requestOpen?: (request: { kind: EPaneOpen; path: string }) => void
  } = {},
) => ({
  sessionId: 'ses-1',
  working: false,
  agentId: undefined,
  openAgent: mock(() => undefined),
  clearAgent: mock(() => undefined),
  openTab: overrides.openTab ?? (() => undefined),
  requestOpen: overrides.requestOpen ?? (() => undefined),
})

describe('panelValueOf', () => {
  it('hands the agent selection and its handlers to the transcript', () => {
    const opened: string[] = []
    let cleared = 0
    const panel = panelValueOf({
      ...wiring(),
      working: true,
      agentId: 'agent-1',
      parentAgentId: 'agent-0',
      openAgent: (agentId) => opened.push(agentId),
      clearAgent: () => {
        cleared += 1
      },
    })

    expect(panel.threadId).toBe('ses-1')
    expect(panel.working).toBe(true)
    expect(panel.agentId).toBe('agent-1')
    expect(panel.agentParentId).toBe('agent-0')
    panel.openAgent('agent-2')
    panel.clearAgent()
    expect(opened).toEqual(['agent-2'])
    expect(cleared).toBe(1)
    expect(panel.details).toBe(EMPTY_DETAILS)
  })

  it('opens the tab for text with a path and requests the pane for a path', () => {
    const tabs: ESessionPaneTab[] = []
    const requests: { kind: EPaneOpen; path: string }[] = []
    const panel = panelValueOf(
      wiring({
        openTab: (tab) => tabs.push(tab),
        requestOpen: (request) => requests.push(request),
      }),
    )

    expect(panel.agentId).toBeUndefined()
    expect(panel.agentParentId).toBeUndefined()
    panel.openChanges()
    panel.openChanges('src/app.ts')
    panel.openFile('src/app.ts')
    panel.openContextFile('$ATLAS_CONTEXT_DIR/plan.md')
    panel.toggleContextFile('$ATLAS_CONTEXT_DIR/plan.md')

    expect(tabs).toEqual([ESessionPaneTab.Changes])
    expect(requests).toEqual([
      { kind: EPaneOpen.Changes, path: 'src/app.ts' },
      { kind: EPaneOpen.File, path: 'src/app.ts' },
      { kind: EPaneOpen.Context, path: '$ATLAS_CONTEXT_DIR/plan.md' },
      { kind: EPaneOpen.Context, path: '$ATLAS_CONTEXT_DIR/plan.md' },
    ])
  })

  it('keeps the closing actions that v2 has no viewer for as no-ops', () => {
    const panel = panelValueOf(wiring())
    expect(panel.closePanel()).toBeUndefined()
    expect(panel.closeFile()).toBeUndefined()
    expect(panel.closeContextFile()).toBeUndefined()
  })
})

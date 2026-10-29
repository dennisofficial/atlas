import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'

import { EAgentStatus } from '@dltech/atlas-core'
import { EToolKind, EToolState } from '@dltech/atlas-ui/ai/tool'

import { ETranscriptKind, type ReportItem, type SpawnItem } from '../../data/transcript-items'
import { ThreadPanelProvider, type ThreadPanelValue } from '../../panel/thread-panel-context'
import { ReportNotice, SpawnCard } from '../transcript-agents'
import { ToolRow } from '../transcript-tool-row'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.innerHTML = ''
})

const panelOf = (overrides: Partial<ThreadPanelValue>): ThreadPanelValue => ({
  threadId: 'thr_1',
  channel: null,
  pod: null,
  working: false,
  changesPath: undefined,
  agentId: undefined,
  openChanges: () => undefined,
  openAgent: () => undefined,
  clearAgent: () => undefined,
  closePanel: () => undefined,
  refreshPod: () => undefined,
  ...overrides,
})

const mount = async (args: { panel: ThreadPanelValue; element: React.ReactElement }) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(<ThreadPanelProvider value={args.panel}>{args.element}</ThreadPanelProvider>),
  )
}

const click = (element: Element | null | undefined) =>
  act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })

const buttonNamed = (name: string) =>
  [...document.body.querySelectorAll('button')].find((button) => button.textContent?.includes(name))

const spawn: SpawnItem = {
  kind: ETranscriptKind.Spawn,
  id: 'evt_3',
  agentId: 'thr_child',
  agentType: 'explore',
  intent: 'vault audit',
  status: EAgentStatus.Finished,
  brief: 'Audit the vault',
  result: 'Found 3 issues',
  at: '2026-10-22T10:00:03.000Z',
  endedAt: '2026-10-22T10:00:09.000Z',
}

const report: ReportItem = {
  kind: ETranscriptKind.Report,
  id: 'evt_8',
  agentId: 'thr_child',
  agentType: 'explore',
  intent: 'vault audit',
  elapsed: '5s',
  failed: false,
  report: 'Found 3 issues',
}

describe('ToolRow', () => {
  it('opens Changes at the edited path', async () => {
    const openChanges = mock((_path?: string) => undefined)
    await mount({
      panel: panelOf({ openChanges }),
      element: (
        <ToolRow
          onOpenChanges={openChanges}
          call={{
            id: 'c1',
            kind: EToolKind.Edit,
            state: EToolState.Done,
            label: 'src/a.ts',
            path: '/repo/src/a.ts',
          }}
        />
      ),
    })
    await click(buttonNamed('src/a.ts') ?? document.querySelector('button[aria-label^="Open"]'))
    expect(openChanges).toHaveBeenCalledWith('/repo/src/a.ts')
  })

  it('renders an edit without a path as a plain row', async () => {
    await mount({
      panel: panelOf({}),
      element: (
        <ToolRow
          onOpenChanges={() => undefined}
          call={{ id: 'c1', kind: EToolKind.Edit, state: EToolState.Done, label: 'src/a.ts' }}
        />
      ),
    })
    expect(document.querySelector('button[aria-label^="Open"]')).toBeNull()
  })
})

describe('ToolRow without actions', () => {
  it('renders an edit without a navigation button', async () => {
    await mount({
      panel: panelOf({}),
      element: (
        <ToolRow
          onOpenChanges={null}
          call={{
            id: 'c1',
            kind: EToolKind.Edit,
            state: EToolState.Done,
            label: 'src/a.ts',
            path: '/repo/src/a.ts',
          }}
        />
      ),
    })
    expect(document.querySelector('button[aria-label^="Open"]')).toBeNull()
  })
})

describe('SpawnCard', () => {
  it('carries the spawn DOM id and shows the brief and model', async () => {
    await mount({
      panel: panelOf({}),
      element: <SpawnCard item={spawn} model="gpt-5" now={0} onOpenAgent={null} />,
    })
    expect(document.getElementById('agent-spawn-thr_child')).not.toBeNull()
    expect(document.body.textContent).toContain('Audit the vault')
    expect(document.body.textContent).toContain('gpt-5')
    expect(document.body.textContent).toContain('Found 3 issues')
  })

  it('opens the agent from Show in agent detail', async () => {
    const openAgent = mock((_id: string) => undefined)
    await mount({
      panel: panelOf({ openAgent }),
      element: <SpawnCard item={spawn} model={undefined} now={0} onOpenAgent={openAgent} />,
    })
    await click(buttonNamed('Show in agent detail'))
    expect(openAgent).toHaveBeenCalledWith('thr_child')
  })
})

describe('ReportNotice', () => {
  it('hides the open button without an action', async () => {
    await mount({ panel: panelOf({}), element: <ReportNotice item={report} onOpenAgent={null} /> })
    expect(buttonNamed('Open in Agents')).toBeUndefined()
  })

  it('opens the reporting agent', async () => {
    const openAgent = mock((_id: string) => undefined)
    await mount({
      panel: panelOf({ openAgent }),
      element: <ReportNotice item={report} onOpenAgent={openAgent} />,
    })
    await click(buttonNamed('reported'))
    await click(buttonNamed('Open in Agents'))
    expect(openAgent).toHaveBeenCalledWith('thr_child')
  })
})

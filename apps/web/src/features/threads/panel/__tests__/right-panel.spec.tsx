import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'

import { EPodState, type PodStatus } from '@dltech/atlas-wire/web'

import { RightPanel } from '../right-panel'
import { ERightTab, isRightTab, TAB_LABEL } from '../right-tab'
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

const router = { push: () => undefined } as unknown as AppRouterInstance

const render = (args: { tab: ERightTab; pod?: PodStatus | null }): string =>
  renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <ThreadPanelProvider value={panel(args.pod ?? null)}>
        <RightPanel tab={args.tab} onTabChange={() => undefined} />
      </ThreadPanelProvider>
    </AppRouterContext.Provider>,
  )

describe('RightPanel', () => {
  it('lists the six tabs in prototype order', () => {
    const html = render({ tab: ERightTab.Agents })
    const positions = Object.values(TAB_LABEL).map((label) => html.indexOf(`>${label}`))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('shows no running count while nothing is running', () => {
    expect(render({ tab: ERightTab.Agents })).not.toContain('tabular-nums')
  })

  it('loads the Agents tab before the thread events arrive', () => {
    expect(render({ tab: ERightTab.Agents })).toContain('data-slot="spinner"')
  })

  it('tells the Changes tab owner the pod is connecting when there is no channel', () => {
    expect(render({ tab: ERightTab.Changes })).toContain('Connecting to the pod')
  })

  it('tells the Files tab owner the sandbox is asleep for a parked pod', () => {
    const html = render({ tab: ERightTab.Files, pod: { state: EPodState.Parked, steps: [] } })
    expect(html).toContain('Sandbox is asleep')
  })

  it('offers to resume a parked pod from the Terminal tab', () => {
    const html = render({ tab: ERightTab.Terminal, pod: { state: EPodState.Parked, steps: [] } })
    expect(html).toContain('Resume pod')
  })

  it('shows the empty state on the Preview tab when nothing is exposed', () => {
    expect(render({ tab: ERightTab.Preview })).toContain('Nothing to preview')
  })
})

describe('isRightTab', () => {
  it('accepts tab values and rejects anything else', () => {
    expect(isRightTab('changes')).toBe(true)
    expect(isRightTab('nope')).toBe(false)
    expect(isRightTab(undefined)).toBe(false)
  })
})

import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'

import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'
import { EPodState, type PodStatus } from '@dltech/atlas-wire/web'

import type { AgentView } from '../../data/agents-model'
import type { AgentsData } from '../../data/use-agents'
import { AgentsTab } from '../agents-tab'
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

const view = (over: Partial<AgentView> = {}): AgentView => ({
  id: 'a',
  agentType: 'explore',
  intent: 'Find importers',
  display: EAgentDisplay.Running,
  live: true,
  startedAt: 0,
  endedAt: undefined,
  model: 'sonnet',
  context: undefined,
  latestCall: 'Using read',
  report: undefined,
  errorText: undefined,
  toolCalls: 1,
  teammate: false,
  ...over,
})

const render = (args: { data: Partial<AgentsData>; pod?: PodStatus | null }): string =>
  renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <ThreadPanelProvider value={panel(args.pod ?? null)}>
        <AgentsTab data={{ agents: [], teammates: [], loaded: true, error: null, ...args.data }} />
      </ThreadPanelProvider>
    </AppRouterContext.Provider>,
  )

describe('AgentsTab', () => {
  it('shows a spinner until the thread events load', () => {
    expect(render({ data: { loaded: false } })).toContain('data-slot="spinner"')
  })

  it('shows the load failure message', () => {
    const html = render({ data: { loaded: false, error: new Error('boom') } })
    expect(html).toContain('Agents unavailable')
    expect(html).toContain('boom')
  })

  it('explains an asleep sandbox when there is nothing to list and no live channel', () => {
    const html = render({ data: {}, pod: { state: EPodState.Parked, steps: [] } })
    expect(html).toContain('Sandbox is asleep')
  })

  it('shows the shared empty state for a thread with no agents and a running pod', () => {
    const html = render({ data: {}, pod: { state: EPodState.Running, steps: [] } })
    expect(html).toContain('No agents yet')
  })

  it('lists running sub-agents and teammates', () => {
    const html = render({
      data: {
        agents: [view()],
        teammates: [{ id: 'thr_2', title: 'Build tabs', display: EAgentDisplay.Running }],
      },
    })
    expect(html).toContain('Find importers')
    expect(html).toContain('Using read')
    expect(html).toContain('Build tabs')
  })

  it('keeps listing known agents while the pod is offline', () => {
    const html = render({
      data: { agents: [view({ display: EAgentDisplay.Done, live: false, latestCall: undefined })] },
      pod: { state: EPodState.Parked, steps: [] },
    })
    expect(html).toContain('Find importers')
  })
})

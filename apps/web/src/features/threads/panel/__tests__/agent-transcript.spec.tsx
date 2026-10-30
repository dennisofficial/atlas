import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'
import type { AgentsPanelAgent } from '@dltech/atlas-ui/ai/agents-panel'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { installVirtuaViewport } from '../../__tests__/virtua-viewport'
import { AgentTranscriptBody } from '../agents/agent-transcript'

let restoreViewport = () => {}

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  restoreViewport = installVirtuaViewport()
})

afterAll(async () => {
  restoreViewport()
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.innerHTML = ''
})

const wire = (seq: number, body: Record<string, unknown>): WireEvent => ({
  id: `evt_${seq}`,
  threadId: 'child',
  seq,
  runId: 'run_1',
  depth: 0,
  at: `2026-10-26T10:00:${String(seq).padStart(2, '0')}.000Z`,
  type: String(body.type),
  body: JSON.stringify(body),
})

const withAnswer: WireEvent[] = [
  wire(1, { type: 'user-said', text: 'Find the importers' }),
  wire(2, { type: 'tool-called', callId: 'c1', name: 'read', input: { path: 'a.ts' }, ordinal: 0 }),
  wire(3, { type: 'tool-result', callId: 'c1', name: 'read', output: 'x', modelText: '12 lines' }),
  wire(4, { type: 'assistant-said', parts: [{ type: 'text', text: 'Three importers found' }] }),
]

const agent = (over: Partial<AgentsPanelAgent> = {}): AgentsPanelAgent => ({
  id: 'child',
  agentType: 'explore',
  intent: 'Find importers',
  display: EAgentDisplay.Done,
  elapsed: '5s',
  model: 'sonnet',
  brief: 'Intent brief',
  calls: [],
  ...over,
})

const mount = async (args: { events: WireEvent[]; fallback: AgentsPanelAgent }) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(
      <AgentTranscriptBody
        events={args.events}
        fallback={args.fallback}
        running={false}
        now={0}
        models={new Map()}
        actions={{ rewind: null, openChanges: null, openAgent: null }}
      />,
    ),
  )
}

describe('AgentTranscriptBody', () => {
  it('renders the brief, tool rows and answer from the child events', async () => {
    await mount({ events: withAnswer, fallback: agent() })
    const text = document.body.textContent ?? ''
    expect(text).toContain('Find the importers')
    expect(text).toContain('Three importers found')
    expect(text).not.toContain('Intent brief')
  })

  it('shows the parent brief while the child has no events', async () => {
    await mount({ events: [], fallback: agent() })
    expect(document.body.textContent).toContain('Intent brief')
  })

  it('appends the parent-side report when the child has no final answer', async () => {
    await mount({
      events: withAnswer.slice(0, 1),
      fallback: agent({ report: <p>Parent report text</p> }),
    })
    expect(document.body.textContent).toContain('Parent report text')
  })

  it('does not duplicate the report when the child answered', async () => {
    await mount({ events: withAnswer, fallback: agent({ report: <p>Parent report text</p> }) })
    expect(document.body.textContent).not.toContain('Parent report text')
  })

  it('shows the failure when the agent failed without an answer', async () => {
    await mount({
      events: withAnswer.slice(0, 1),
      fallback: agent({ display: EAgentDisplay.Failed, errorText: 'Sandbox lost' }),
    })
    expect(document.body.textContent).toContain('Sandbox lost')
  })
})

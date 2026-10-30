import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'

import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'
import type { AgentsPanelAgent } from '@dltech/atlas-ui/ai/agents-panel'
import * as realMessage from '@dltech/atlas-ui/ai/message'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { installVirtuaViewport } from '../../__tests__/virtua-viewport'

const renders = { agent: 0 }
const realAgent = realMessage.AgentMessage
const realExports = { ...realMessage }

mock.module('@dltech/atlas-ui/ai/message', () => ({
  ...realExports,
  AgentMessage: (props: Parameters<typeof realAgent>[0]) => {
    renders.agent += 1
    return realAgent(props)
  },
}))
mock.module('@dltech/atlas-ui/ai/message-response', () => ({
  MessageResponse: ({ children }: { children: unknown }) => <p>{String(children)}</p>,
}))

const { AgentTranscriptBody } = await import('../agents/agent-transcript')

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

const say = (seq: number, text: string) =>
  wire(seq, { type: 'assistant-said', parts: [{ type: 'text', text }] })

const events: WireEvent[] = [
  wire(1, { type: 'user-said', text: 'first' }),
  say(2, 'first answer'),
  wire(3, { type: 'user-said', text: 'second' }),
  say(4, 'second answer'),
]

const fallback: AgentsPanelAgent = {
  id: 'child',
  agentType: 'explore',
  intent: 'Find importers',
  display: EAgentDisplay.Running,
  elapsed: '5s',
  model: 'sonnet',
  brief: 'Intent brief',
  calls: [],
}

describe('AgentTranscriptBody re-renders', () => {
  it('re-renders only the running turn when the clock ticks', async () => {
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const models = new Map<string, string>()
    const actions = { rewind: null, openChanges: null, openAgent: null }
    const render = (now: number) =>
      act(async () =>
        root.render(
          <AgentTranscriptBody
            events={events}
            fallback={fallback}
            running
            now={now}
            models={models}
            actions={actions}
          />,
        ),
      )
    await render(1000)
    renders.agent = 0

    await render(2000)

    expect(renders.agent).toBe(1)
  })
})

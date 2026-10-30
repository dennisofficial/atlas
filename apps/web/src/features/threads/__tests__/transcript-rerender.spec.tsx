import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'

import * as realMessage from '@dltech/atlas-ui/ai/message'

const renders = { user: 0, agent: 0 }
const realUser = realMessage.UserMessage
const realAgent = realMessage.AgentMessage
const realExports = { ...realMessage }

mock.module('@dltech/atlas-ui/ai/message', () => ({
  ...realExports,
  UserMessage: (props: Parameters<typeof realUser>[0]) => {
    renders.user += 1
    return realUser(props)
  },
  AgentMessage: (props: Parameters<typeof realAgent>[0]) => {
    renders.agent += 1
    return realAgent(props)
  },
}))
mock.module('@dltech/atlas-ui/ai/message-response', () => ({
  MessageResponse: ({ children }: { children: unknown }) => <p>{String(children)}</p>,
}))

const { ETranscriptKind } = await import('../data/transcript-items')
const { EMPTY_DETAILS } = await import('../panel/details/details-input')
const { ThreadPanelProvider } = await import('../panel/thread-panel-context')
const { createTestQueryClient, TestQueryProvider } = await import(
  '@/lib/__tests__/query-test-provider'
)
const { ThreadTranscript } = await import('../thread-transcript')

import type { TranscriptRow } from '../data/transcript-items'
import { installVirtuaViewport } from './virtua-viewport'

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

const panel = {
  threadId: 'thr_1',
  channel: null,
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

const at = (second: number) => `2026-10-28T10:00:${String(second).padStart(2, '0')}.000Z`

const pair = (index: number): TranscriptRow[] => [
  { kind: ETranscriptKind.User, id: `u${index}`, text: `ask ${index}`, at: at(index * 2) },
  {
    kind: ETranscriptKind.Agent,
    id: `a${index}`,
    text: `answer ${index}`,
    streaming: false,
    at: at(index * 2 + 1),
  },
]

const completed = (): TranscriptRow[] => [0, 1, 2, 3].flatMap(pair)

const setup = async () => {
  const intervals: Array<() => void> = []
  globalThis.setInterval = ((callback: () => void) => {
    intervals.push(callback)
    return intervals.length
  }) as unknown as typeof setInterval
  globalThis.clearInterval = (() => undefined) as typeof clearInterval
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = (rows: TranscriptRow[], working: boolean) =>
    act(async () =>
      root.render(
        <TestQueryProvider client={createTestQueryClient()}>
          <ThreadPanelProvider value={panel}>
            <ThreadTranscript
              items={rows}
              failure={null}
              pod={null}
              working={working}
              onRetryBoot={() => undefined}
              rewind={null}
            />
          </ThreadPanelProvider>
        </TestQueryProvider>,
      ),
    )
  const tick = () =>
    act(async () => {
      for (const callback of intervals) callback()
    })
  return { render, tick }
}

const reset = () => {
  renders.user = 0
  renders.agent = 0
}

describe('ThreadTranscript re-renders', () => {
  it('re-renders only the running turn on a clock tick while working', async () => {
    const { render, tick } = await setup()
    await render(completed(), true)
    reset()

    await tick()

    expect(renders).toEqual({ user: 0, agent: 1 })
  })

  it('re-renders only the new turn when an event is appended', async () => {
    const { render } = await setup()
    await render(completed(), false)
    reset()

    await render([...completed(), ...pair(4).slice(0, 1)], false)

    expect(renders).toEqual({ user: 1, agent: 0 })
  })
})

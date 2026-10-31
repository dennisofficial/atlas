import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { act } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'

import { ERunFailureKind, stampDrafts, toEventId, toRunId, toThreadId } from '@dltech/atlas-core'
import type { Event, EventDraft, EventEnvelope } from '@dltech/atlas-core'

mock.module('next/navigation', () => ({ useRouter: () => ({ push: mock(() => undefined) }) }))
mock.module('sonner', () => ({ toast: { error: mock(() => undefined) } }))

const { TestQueryProvider, createTestQueryClient } = await import(
  '@/lib/__tests__/query-test-provider'
)
const { useRunAttention } = await import('../use-run-attention')

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

const unmounts: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const unmount of unmounts.splice(0)) await unmount()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const authFailure = { kind: ERunFailureKind.Auth, message: 'bad key' }

const envelopeAt = (index: number): EventEnvelope => ({
  id: toEventId(`event-${index + 1}`),
  seq: index + 1,
  threadId: toThreadId('thread-card'),
  runId: toRunId('run-card'),
  depth: 0,
  at: '2026-10-28T10:00:00.000Z',
})

const log = (drafts: readonly EventDraft[]): Event[] =>
  stampDrafts({ drafts, envelopes: drafts.map((_draft, index) => envelopeAt(index)) })

const failedLog = (extra: readonly EventDraft[] = []): Event[] =>
  log([{ type: 'user-said', text: 'go' }, { type: 'run-failed', failure: authFailure }, ...extra])

type Api = ReturnType<typeof useRunAttention>
type Source = Parameters<typeof useRunAttention>[0]['source']

async function mount(args: { events: Event[]; dismissFailure?: Source['dismissFailure'] }) {
  const { createRoot } = await import('react-dom/client')
  const box: { api: Api | null } = { api: null }
  const source: Source = {
    working: false,
    live: true,
    channel: {} as Source['channel'],
    retry: () => true,
    dismissFailure: args.dismissFailure ?? (() => true),
  }
  function Probe(props: { events: Event[] }) {
    box.api = useRunAttention({
      events: props.events,
      live: [],
      source,
      commands: { setModelOpen: () => undefined, handleCommand: async () => true },
      panel: { openAgent: () => undefined },
    })
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () =>
    root.render(
      <TestQueryProvider client={createTestQueryClient()}>
        <Probe events={args.events} />
      </TestQueryProvider>,
    ),
  )
  unmounts.push(() => act(async () => root.unmount()))
  return box
}

describe('useRunAttention card', () => {
  it('carries the classified copy for a durable failure', async () => {
    const box = await mount({ events: failedLog() })
    expect(box.api?.card).toEqual({
      title: 'The provider rejected the API key',
      detail:
        'The provider rejected the API key for this account. Update it in Settings → Providers, then retry.',
      onDismiss: expect.any(Function),
    })
    expect(box.api?.failedLabel).not.toBeNull()
    expect(box.api?.strip?.title).toBe('The provider rejected the API key')
  })

  it('yields no card once a later assistant message supersedes the failure', async () => {
    const box = await mount({
      events: failedLog([{ type: 'assistant-said', parts: [] }]),
    })
    expect(box.api?.card).toBeNull()
    expect(box.api?.strip).toBeNull()
    expect(box.api?.failedLabel).toBeNull()
  })

  it('yields no card once the failure is dismissed', async () => {
    const box = await mount({
      events: failedLog([{ type: 'run-failure-dismissed', failureSeq: 2 }]),
    })
    expect(box.api?.card).toBeNull()
    expect(box.api?.strip).toBeNull()
    expect(box.api?.failedLabel).toBeNull()
  })

  it('keeps the strip but no card for resume-only attention', async () => {
    const box = await mount({
      events: log([
        { type: 'user-said', text: 'go' },
        { type: 'assistant-said', parts: [] },
        { type: 'user-said', text: 'continue' },
      ]),
    })
    expect(box.api?.card).toBeNull()
    expect(box.api?.failedLabel).toBeNull()
    expect(box.api?.strip?.title).toBe('The run stopped before finishing')
  })

  it('dismisses through the card button', async () => {
    const dismissed: number[] = []
    const box = await mount({
      events: failedLog(),
      dismissFailure: ({ failureSeq }) => {
        dismissed.push(failureSeq)
        return true
      },
    })
    await act(async () => box.api?.card?.onDismiss?.())
    expect(dismissed).toEqual([2])
  })
})

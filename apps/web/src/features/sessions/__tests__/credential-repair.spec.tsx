import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import * as realNavigation from 'next/navigation'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import {
  EAgentStatus,
  ERunFailureKind,
  chainEvents,
  toRunId,
  toThreadId,
  type RunFailure,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'

import { TestQueryProvider, createTestQueryClient } from '@/lib/__tests__/query-test-provider'

const MAIN = toThreadId('thread-1')
const CHILD = toThreadId('agent-1')

const failure: RunFailure = {
  kind: ERunFailureKind.Auth,
  message: 'invalid x-api-key',
  providerId: 'anthropic',
  modelId: 'claude-opus-5-5',
  accountId: 'acc_1',
}

const accounts = [
  {
    id: 'acc_1',
    provider: 'anthropic',
    kind: 'api-key',
    label: 'dennis@example.com',
    status: 'active',
    createdAt: '2026-11-01T00:00:00.000Z',
  },
  {
    id: 'acc_2',
    provider: 'anthropic',
    kind: 'oauth',
    label: 'work@example.com',
    status: 'active',
    createdAt: '2026-11-01T00:00:00.000Z',
  },
]

const replaced: { accountId: string; apiKey: string }[] = []
const activated: { provider: string; accountId: string }[] = []
const retried: unknown[] = []
const errors: string[] = []
let replaceFails = false

mock.module('@/features/settings/data/personal/accounts-api', () => ({
  fetchAccounts: async () => accounts,
  replaceApiKey: async (args: { accountId: string; apiKey: string }) => {
    if (replaceFails) throw new Error('the key was refused')
    replaced.push(args)
  },
  createApiKeyAccount: async (args: { provider: string; apiKey: string }) => {
    replaced.push({ accountId: '', apiKey: args.apiKey })
  },
  activateAccount: async (args: { provider: string; accountId: string }) => {
    activated.push(args)
  },
}))

mock.module('@/features/sessions/data/sessions-api', () => ({
  sessionsApi: {
    retry: async (input: unknown) => {
      retried.push(input)
      return { inboxId: retried.length }
    },
  },
}))

mock.module('sonner', () => ({
  toast: { error: (message: string) => errors.push(message) },
}))

const pushed: string[] = []

mock.module('next/navigation', () => ({
  ...realNavigation,
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}))

const { useCredentialRepair } = await import('../data/use-credential-repair')
const { useSessionRunFailure } = await import('../data/use-session-run-failure')
const { RepairCard } = await import('@/features/threads/transcript/repair-card')

type Control = ReturnType<typeof useCredentialRepair>

const eventsOf = (bodies: readonly V2Body[]): V2Event[] =>
  chainEvents({
    threadId: MAIN,
    runId: toRunId('run-1'),
    epoch: 1,
    at: '2026-11-23T10:00:00.000Z',
    from: undefined,
    bodies,
  })

let root: Root | null = null
let latest: Control | null = null

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const render = async (events: readonly V2Event[]): Promise<void> => {
  if (root !== null) {
    const previous = root
    root = null
    await act(async () => previous.unmount())
  }
  const { createRoot } = await import('react-dom/client')
  const mounted = createRoot(document.createElement('div'))
  root = mounted
  function Probe({ next }: { next: readonly V2Event[] }) {
    latest = useCredentialRepair({
      sessionId: 's1',
      mainThreadId: 'thread-1',
      events: next,
      onSwitchModel: () => {
        switched += 1
      },
    })
    return <p>{latest.card?.title ?? ''}</p>
  }
  await act(async () =>
    mounted.render(
      <TestQueryProvider client={createTestQueryClient()}>
        <Probe next={events} />
      </TestQueryProvider>,
    ),
  )
  await flush()
  await flush()
}

const controlOf = (): Control => {
  if (latest === null) throw new Error('expected a mounted control')
  return latest
}

const actionOf = (label: string) => {
  const action = controlOf().card?.actions.find((entry) => entry.label === label)
  if (action === undefined) throw new Error(`expected the ${label} action`)
  return action
}

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await act(async () => root?.unmount())
  await unregisterDom()
})

beforeEach(() => {
  replaced.length = 0
  activated.length = 0
  retried.length = 0
  errors.length = 0
  pushed.length = 0
  replaceFails = false
  const primary = accounts[0]
  if (primary !== undefined) primary.kind = 'api-key'
})

describe('useCredentialRepair', () => {
  it('shows the account, the provider and the model on the card', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    await render(
      eventsOf([
        { type: 'user-said', text: 'go' },
        { type: 'run-failed', failure },
      ]),
    )

    const card = controlOf().card
    if (card === null) throw new Error('expected a repair card')
    expect(card.title).toBe('Atlas could not call claude-opus-5-5')
    expect(card.detail).toBe('Anthropic · dennis@example.com · The sign-in is no longer accepted')
    const markup = renderToStaticMarkup(<RepairCard {...card} />)
    expect(markup).toContain('dennis@example.com')
    expect(markup).toContain('Replace key')
  })

  it('draws a credential wait with no failure event', async () => {
    await render(
      eventsOf([
        {
          type: 'model-waiting',
          waiting: {
            episode: {
              kind: 'credential',
              key: { accountId: 'acc_1', providerId: 'anthropic', modelId: 'claude-opus-5-5' },
              generation: 0,
            },
            cause: 'availability',
            providerId: 'anthropic',
            accountId: 'acc_1',
            modelId: 'claude-opus-5-5',
            reason: 'auth',
            resetAt: null,
            affectedThreadIds: [MAIN],
          },
        },
      ]),
    )

    expect(controlOf().card?.title).toBe('Atlas could not call claude-opus-5-5')
    expect(controlOf().strip).not.toBeNull()
  })

  it('opens the sign-in dialog instead of leaving the session', async () => {
    const primary = accounts[0]
    if (primary !== undefined) primary.kind = 'oauth'
    await render(eventsOf([{ type: 'run-failed', failure }]))

    await act(async () => actionOf('Re-sign in').onSelect())

    expect(controlOf().dialogs.signIn.open).toBe(true)
    expect(controlOf().dialogs.signIn.provider).toBe('anthropic')
    expect(retried).toEqual([])
  })

  it('saves one masked key and retries once', async () => {
    await render(eventsOf([{ type: 'run-failed', failure }]))

    await act(async () => actionOf('Replace key').onSelect())
    expect(controlOf().dialogs.key.open).toBe(true)

    await act(async () => {
      controlOf().dialogs.key.onSubmit('sk-ant-test')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(replaced).toEqual([{ accountId: 'acc_1', apiKey: 'sk-ant-test' }])
    expect(retried).toEqual([{ sessionId: 's1' }])
  })

  it('switches to another account and says new sessions use it too', async () => {
    await render(eventsOf([{ type: 'run-failed', failure }]))

    expect(actionOf('Use work@example.com').label).toBe('Use work@example.com')
    await act(async () => {
      actionOf('Use work@example.com').onSelect()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(activated).toEqual([{ provider: 'anthropic', accountId: 'acc_2' }])
    expect(retried).toEqual([{ sessionId: 's1' }])
  })

  it('posts no retry when the repair fails', async () => {
    replaceFails = true
    await render(eventsOf([{ type: 'run-failed', failure }]))

    await act(async () => {
      actionOf('Replace key').onSelect()
      controlOf().dialogs.key.onSubmit('sk-ant-test')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(errors).toEqual(['the key was refused'])
    expect(retried).toEqual([])
  })

  it('clears the card and the strip once the turn starts again', async () => {
    await render(eventsOf([{ type: 'run-failed', failure }]))
    expect(controlOf().strip?.actions.length).toBe(1)

    await render(
      eventsOf([
        { type: 'run-failed', failure },
        { type: 'turn-started', at: '2026-11-23T10:01:00.000Z' },
      ]),
    )

    expect(controlOf().card).toBeNull()
    expect(controlOf().strip).toBeNull()
  })

  it('does not render a repair for a failed sub-agent on its own panel', async () => {
    await render(
      eventsOf([
        { type: 'run-failed', failure },
        {
          type: 'agent-ended',
          agentId: CHILD,
          agentType: 'builder',
          intent: 'fix the tests',
          status: EAgentStatus.Failed,
          prose: 'stopped',
          turns: 1,
          toolCalls: 2,
          failure,
        },
      ]),
    )

    const card = controlOf().card
    if (card === null) throw new Error('expected a repair card')
    expect(card.notes).toContain('Waiting: builder — fix the tests')
  })
})

describe('useSessionRunFailure', () => {
  let opened = 0

  const failureControlOf = async (args: { canRepair: boolean; events: readonly V2Event[] }) => {
    const { createRoot } = await import('react-dom/client')
    const mounted = createRoot(document.createElement('div'))
    let handlers: ReturnType<typeof useSessionRunFailure> | null = null
    function Probe({ next }: { next: readonly V2Event[] }) {
      handlers = useSessionRunFailure({
        sessionId: 's1',
        events: next,
        working: false,
        openAgent: () => undefined,
        onSwitchModel: () => undefined,
        repair: {
          card: null,
          canRepair: args.canRepair,
          openPrimary: () => {
            opened += 1
          },
        },
      })
      return <p>{handlers.card?.title ?? ''}</p>
    }
    await act(async () =>
      mounted.render(
        <TestQueryProvider client={createTestQueryClient()}>
          <Probe next={args.events} />
        </TestQueryProvider>,
      ),
    )
    await flush()
    if (handlers === null) throw new Error('expected the failure hook')
    const control: ReturnType<typeof useSessionRunFailure> = handlers
    await act(async () => mounted.unmount())
    return control
  }

  it('opens the primary repair action instead of leaving the session', async () => {
    const events = eventsOf([{ type: 'run-failed', failure }])
    const control = await failureControlOf({ canRepair: true, events })
    const fix = control.card?.actions?.find((action) => action.label === 'Update key')

    fix?.onSelect()

    expect(opened).toBe(1)
    expect(pushed).toEqual([])
  })
})

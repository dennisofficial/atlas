import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { act } from 'react'

import {
  EAgentStatus,
  ERunFailureKind,
  type RunFailure,
  type RecordEvent,
} from '@dltech/atlas-core'

import { RepairCard } from '@/features/threads/transcript/repair-card'

import {
  CHILD,
  MAIN,
  accounts,
  activated,
  controlOf,
  counters,
  errors,
  eventsOf,
  mountRepair,
  pushed,
  replaced,
  resetProbe,
  retried,
  state,
  unmountRepair,
} from './repair-probe'

const failure: RunFailure = {
  kind: ERunFailureKind.Auth,
  message: 'invalid x-api-key',
  providerId: 'anthropic',
  modelId: 'claude-opus-5-5',
  accountId: 'acc_1',
}

const render = async (events: readonly RecordEvent[]): Promise<void> =>
  mountRepair({
    events,
    onSwitchModel: () => {
      counters.switched += 1
    },
  })

const actionOf = (label: string) => {
  const action = controlOf().card?.actions.find((entry) => entry.label === label)
  if (action === undefined) throw new Error(`expected the ${label} action`)
  return action
}

const cardOf = () => {
  const card = controlOf().card
  if (card === null) throw new Error('expected a repair card')
  return card
}

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unmountRepair()
  await unregisterDom()
})

beforeEach(() => {
  resetProbe()
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

    const card = cardOf()
    expect(card.title).toBe('Atlas could not call claude-opus-5-5')
    expect(card.detail).toBe('Anthropic · dennis@example.com · The key was refused')
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
    const { renderToStaticMarkup } = await import('react-dom/server')
    await render(eventsOf([{ type: 'run-failed', failure }]))

    expect(actionOf('Use work@example.com').label).toBe('Use work@example.com')
    await act(async () => {
      actionOf('Use work@example.com').onSelect()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(activated).toEqual([{ provider: 'anthropic', accountId: 'acc_2' }])
    expect(retried).toEqual([{ sessionId: 's1' }])
    expect(renderToStaticMarkup(<RepairCard {...cardOf()} />)).toContain(
      'New sessions will use it too.',
    )
  })

  it('keeps a retry action on the repair card', async () => {
    await render(eventsOf([{ type: 'run-failed', failure }]))

    expect(actionOf('Retry').primary).toBe(false)

    await act(async () => {
      actionOf('Retry').onSelect()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(retried).toEqual([{ sessionId: 's1' }])
  })

  it('retries once after a model switch made from the repair', async () => {
    await render(eventsOf([{ type: 'run-failed', failure }]))

    await act(async () => actionOf('Switch model').onSelect())

    expect(counters.switched).toBe(1)
    expect(retried).toEqual([])

    await act(async () => {
      controlOf().handleModelSelected()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(retried).toEqual([{ sessionId: 's1' }])
  })

  it('leaves a model choice made from the composer alone', async () => {
    await render(eventsOf([{ type: 'run-failed', failure }]))

    await act(async () => {
      controlOf().handleModelSelected()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(retried).toEqual([])
  })

  it('posts no retry when the repair fails', async () => {
    state.replaceFails = true
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

    expect(cardOf().notes).toContain('Waiting: builder — fix the tests')
  })

  it('leaves the provider settings link out while the repair can act', async () => {
    await render(eventsOf([{ type: 'run-failed', failure }]))

    expect(pushed).toEqual([])
    expect(controlOf().card?.actions.some((action) => action.id === 'providers')).toBe(false)
  })
})

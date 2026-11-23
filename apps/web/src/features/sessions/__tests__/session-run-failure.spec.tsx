import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { ERunFailureKind, type RunFailure } from '@dltech/atlas-core'

import { PROVIDERS_HREF } from '@/features/settings/settings-nav'
import { TestQueryProvider, createTestQueryClient } from '@/lib/__tests__/query-test-provider'

import { counters, eventsOf, pushed, resetProbe } from './repair-probe'

const { useSessionRunFailure } = await import('../data/use-session-run-failure')

const failure: RunFailure = {
  kind: ERunFailureKind.Auth,
  message: 'invalid x-api-key',
  providerId: 'anthropic',
  modelId: 'claude-opus-5-5',
  accountId: 'acc_1',
}

const repairCard = {
  title: 'Atlas could not call claude-opus-5-5',
  detail: 'Anthropic · dennis@example.com · The sign-in is no longer accepted',
  notes: [],
  actions: [{ id: 're-sign-in', label: 'Re-sign in', primary: true, onSelect: () => undefined }],
}

type FailureControl = ReturnType<typeof useSessionRunFailure>

const controlOf = async (args: {
  canRepair: boolean
  accountKnown: boolean
  card?: boolean
}): Promise<FailureControl> => {
  const { createRoot } = await import('react-dom/client')
  const mounted = createRoot(document.createElement('div'))
  const events = eventsOf([
    { type: 'user-said', text: 'go' },
    { type: 'run-failed', failure },
  ])
  let handlers: FailureControl | null = null
  function Probe() {
    handlers = useSessionRunFailure({
      sessionId: 's1',
      events,
      working: false,
      openAgent: () => undefined,
      onSwitchModel: () => undefined,
      repair: {
        card: args.card === false ? null : repairCard,
        canRepair: args.canRepair,
        accountKnown: args.accountKnown,
        openPrimary: () => {
          counters.opened += 1
        },
      },
    })
    return <p>{handlers.card?.title ?? ''}</p>
  }
  await act(async () =>
    mounted.render(
      <TestQueryProvider client={createTestQueryClient()}>
        <Probe />
      </TestQueryProvider>,
    ),
  )
  if (handlers === null) throw new Error('expected the failure hook')
  const control: FailureControl = handlers
  await act(async () => mounted.unmount())
  return control
}

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

beforeEach(() => {
  resetProbe()
})

describe('useSessionRunFailure', () => {
  it('opens the primary repair action instead of leaving the session', async () => {
    const control = await controlOf({ canRepair: true, accountKnown: true, card: false })
    const fix = control.card?.actions?.find((action) => action.label === 'Update key')

    fix?.onSelect()

    expect(counters.opened).toBe(1)
    expect(pushed).toEqual([])
  })

  it('keeps the repair card in place of the generic failure card', async () => {
    const control = await controlOf({ canRepair: true, accountKnown: true })

    expect(control.card).toBeNull()
    expect(control.repairCard?.actions.map((action) => action.label)).toEqual(['Re-sign in'])
  })

  it('adds the providers page when there is no account to repair', async () => {
    const control = await controlOf({ canRepair: false, accountKnown: false })
    const providers = control.repairCard?.actions.find((action) => action.id === 'providers')

    providers?.onSelect()

    expect(providers?.label).toBe('Update key')
    expect(providers?.primary).toBe(false)
    expect(pushed).toEqual([PROVIDERS_HREF])
  })

  it('keeps the providers page out while the account is known', async () => {
    const control = await controlOf({ canRepair: false, accountKnown: true })

    expect(control.repairCard?.actions.some((action) => action.id === 'providers')).toBe(false)
  })
})

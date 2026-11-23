import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { ERunFailureKind, type RunFailure } from '@dltech/atlas-core'

import { PROVIDERS_HREF } from '@/features/settings/settings-nav'
import { TestQueryProvider, createTestQueryClient } from '@/lib/__tests__/query-test-provider'

import { counters, errors, eventsOf, pushed, resetProbe, retried, state } from './repair-probe'

import type { ModelSwitchRetry } from '../data/use-model-switch-retry'

const { useSessionRunFailure } = await import('../data/use-session-run-failure')
const { useModelSwitchRetry } = await import('../data/use-model-switch-retry')

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

let root: Root | null = null
let latest: FailureControl | null = null
let latestSwitch: ModelSwitchRetry | null = null

const mount = async (args: {
  canRepair: boolean
  accountKnown: boolean
  card?: boolean
}): Promise<void> => {
  const { createRoot } = await import('react-dom/client')
  if (root !== null) {
    const previous = root
    root = null
    await act(async () => previous.unmount())
  }
  const mounted = createRoot(document.createElement('div'))
  root = mounted
  const events = eventsOf([
    { type: 'user-said', text: 'go' },
    { type: 'run-failed', failure },
  ])
  function Probe() {
    const switchRetry = useModelSwitchRetry()
    latestSwitch = switchRetry
    latest = useSessionRunFailure({
      sessionId: 's1',
      events,
      working: false,
      openAgent: () => undefined,
      onSwitchModel: () => {
        counters.switched += 1
      },
      retryAfterModel: switchRetry,
      repair: {
        card: args.card === false ? null : repairCard,
        canRepair: args.canRepair,
        accountKnown: args.accountKnown,
        openPrimary: () => {
          counters.opened += 1
        },
      },
    })
    return <p>{latest.card?.title ?? ''}</p>
  }
  await act(async () =>
    mounted.render(
      <TestQueryProvider client={createTestQueryClient()}>
        <Probe />
      </TestQueryProvider>,
    ),
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const controlOf = (): FailureControl => {
  if (latest === null) throw new Error('expected the failure hook')
  return latest
}

const switchOf = (): ModelSwitchRetry => {
  if (latestSwitch === null) throw new Error('expected the model switch retry')
  return latestSwitch
}

const actionOf = (label: string) => {
  const action = controlOf().card?.actions?.find((entry) => entry.label === label)
  if (action === undefined) throw new Error(`expected the ${label} action`)
  return action
}

const unmount = async (): Promise<void> => {
  await act(async () => root?.unmount())
  root = null
  latest = null
  latestSwitch = null
}

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unmount()
  await unregisterDom()
})

beforeEach(async () => {
  await unmount()
  resetProbe()
})

describe('useSessionRunFailure', () => {
  it('opens the primary repair action instead of leaving the session', async () => {
    await mount({ canRepair: true, accountKnown: true, card: false })
    const fix = controlOf().card?.actions?.find((action) => action.label === 'Update key')

    fix?.onSelect()

    expect(counters.opened).toBe(1)
    expect(pushed).toEqual([])
  })

  it('keeps the repair card in place of the generic failure card', async () => {
    await mount({ canRepair: true, accountKnown: true })

    expect(controlOf().card).toBeNull()
    expect(controlOf().repairCard?.actions.map((action) => action.label)).toEqual(['Re-sign in'])
  })

  it('adds the providers page when there is no account to repair', async () => {
    await mount({ canRepair: false, accountKnown: false })
    const providers = controlOf().repairCard?.actions.find((action) => action.id === 'providers')

    providers?.onSelect()

    expect(providers?.label).toBe('Update key')
    expect(providers?.primary).toBe(false)
    expect(pushed).toEqual([PROVIDERS_HREF])
  })

  it('keeps the providers page out while the account is known', async () => {
    await mount({ canRepair: false, accountKnown: true })

    expect(controlOf().repairCard?.actions.some((action) => action.id === 'providers')).toBe(false)
  })

  it('retries once and shows the retry as pending', async () => {
    await mount({ canRepair: false, accountKnown: true, card: false })

    await act(async () => {
      actionOf('Retry').onSelect()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const retry = actionOf('Retry')
    expect(retried).toEqual([{ sessionId: 's1' }])
    expect(retry.pending).toBe(true)
    expect(retry.pendingLabel).toBe('Retrying…')
    expect(retry.disabled).toBe(true)
  })

  it('refuses a second retry before the first one answers', async () => {
    await mount({ canRepair: false, accountKnown: true, card: false })

    await act(async () => {
      const press = actionOf('Retry').onSelect
      press()
      press()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(retried).toEqual([{ sessionId: 's1' }])
  })

  it('clears the pending retry when the sandbox refused it', async () => {
    state.retryFails = true
    await mount({ canRepair: false, accountKnown: true, card: false })

    await act(async () => {
      actionOf('Retry').onSelect()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(retried).toEqual([])
    expect(errors).toEqual(['the sandbox did not answer'])
    expect(actionOf('Retry').pending).not.toBe(true)
  })

  it('retries once after a model switch made from the failure card', async () => {
    await mount({ canRepair: false, accountKnown: true, card: false })

    await act(async () => actionOf('Switch model').onSelect())

    expect(counters.switched).toBe(1)
    expect(retried).toEqual([])

    await act(async () => {
      switchOf().handleModelSelected()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(retried).toEqual([{ sessionId: 's1' }])
    expect(actionOf('Retry').pendingLabel).toBe('Retrying…')
  })

  it('leaves a model choice made from the composer alone', async () => {
    await mount({ canRepair: false, accountKnown: true, card: false })

    await act(async () => {
      switchOf().handleModelSelected()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(retried).toEqual([])
  })

  it('drops the retry when the picker closes without a selection', async () => {
    await mount({ canRepair: false, accountKnown: true, card: false })

    await act(async () => {
      actionOf('Switch model').onSelect()
      switchOf().disarm()
      switchOf().handleModelSelected()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(retried).toEqual([])
  })
})

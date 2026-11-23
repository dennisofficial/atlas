import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import type { UsageReportDto, UsageReportInput } from '@dltech/atlas-protocol'

import { EAccountKind, type Account } from '../../data/personal/accounts-api'
import {
  EProviderSignInState,
  type ProviderSignInControl,
} from '../../data/personal/use-provider-sign-in'
import { EProviderId, PROVIDERS } from '../../fixtures/settings-agent'
import { ProviderCard, type ProviderCardActions } from '../provider-card'

const METERED: UsageReportDto = {
  accountId: null,
  label: 'dennis@byatlas.io',
  metered: true,
  fiveHour: { utilization: 68, resetsAt: null },
  sevenDay: null,
  fetchedAt: '2026-11-23T12:00:00.000Z',
}

mock.module('@/features/settings/data/personal/usage-api', () => ({
  fetchUsageReport: async (input: UsageReportInput): Promise<UsageReportDto> =>
    'accountId' in input
      ? { ...METERED, accountId: input.accountId }
      : { ...METERED, metered: false },
  usageQueryKey: (input: UsageReportInput): string =>
    'accountId' in input ? `usage-account-${input.accountId}` : `usage-provider-${input.provider}`,
}))

const ANTHROPIC = PROVIDERS[0]

if (ANTHROPIC === undefined) throw new Error('the catalogue has no Anthropic entry')

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(async () => {
  const mounted = root
  if (mounted !== null) await act(async () => mounted.unmount())
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
})

async function render(node: ReactNode): Promise<HTMLDivElement> {
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const mounted = root
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () =>
    mounted.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>),
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return container
}

const click = async (element: Element | null | undefined): Promise<void> => {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

const signIn = (): ProviderSignInControl => ({
  flow: { status: EProviderSignInState.Idle },
  start: () => {},
  cancel: () => {},
  submitCode: () => {},
})

const actionsOf = (overrides: Partial<ProviderCardActions> = {}): ProviderCardActions => ({
  onUse: () => {},
  onSignIn: () => {},
  onAddKey: async () => null,
  onRename: () => {},
  onReplace: async () => null,
  onRemove: () => {},
  ...overrides,
})

const planAccount = (args: { id: string } & Partial<Account>): Account => ({
  id: args.id,
  provider: EProviderId.Anthropic,
  kind: EAccountKind.Oauth,
  label: 'Claude',
  status: 'active',
  createdAt: '2026-11-12T00:00:00.000Z',
  ...args,
})

const keyAccount = (args: { id: string } & Partial<Account>): Account => ({
  id: args.id,
  provider: EProviderId.Anthropic,
  kind: EAccountKind.ApiKey,
  label: 'Work',
  status: 'active',
  createdAt: '2026-11-03T00:00:00.000Z',
  ...args,
})

const radios = (element: HTMLElement): HTMLElement[] => [
  ...element.querySelectorAll<HTMLElement>('[role="radio"]'),
]

const radioInputs = (element: HTMLElement): HTMLElement[] => [
  ...element.querySelectorAll<HTMLElement>('input[type="radio"]'),
]

describe('a provider holding two accounts', () => {
  const accounts = [
    planAccount({ id: 'first', email: 'one@example.com', subscription: 'max' }),
    keyAccount({ id: 'second', label: 'Work', keyHint: '4f2a' }),
  ]

  it('offers one radio per account and marks the one in use', async () => {
    const used: string[] = []
    const element = await render(
      <ProviderCard
        provider={ANTHROPIC}
        accounts={accounts}
        inUseId="second"
        signIn={signIn()}
        actions={actionsOf({ onUse: (accountId) => used.push(accountId) })}
      />,
    )

    expect(radios(element)).toHaveLength(2)
    expect(radios(element).map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
    ])
    expect(element.textContent).toContain('In use')
  })

  it('uses the account of the radio that was picked', async () => {
    const used: string[] = []
    const element = await render(
      <ProviderCard
        provider={ANTHROPIC}
        accounts={accounts}
        inUseId="second"
        signIn={signIn()}
        actions={actionsOf({ onUse: (accountId) => used.push(accountId) })}
      />,
    )

    await click(radioInputs(element)[0])

    expect(used).toEqual(['first'])
  })

  it('describes a plan row and a key row', async () => {
    const element = await render(
      <ProviderCard
        provider={ANTHROPIC}
        accounts={accounts}
        inUseId="second"
        signIn={signIn()}
        actions={actionsOf()}
      />,
    )

    expect(element.textContent).toContain('one@example.com')
    expect(element.textContent).toContain('Claude Max plan · Signed in Nov 12')
    expect(element.textContent).toContain('API key · sk-ant-…4f2a · Added Nov 3')
  })
})

describe('a provider holding one account', () => {
  it('shows no radio', async () => {
    const element = await render(
      <ProviderCard
        provider={ANTHROPIC}
        accounts={[planAccount({ id: 'only', email: 'one@example.com' })]}
        inUseId="only"
        signIn={signIn()}
        actions={actionsOf()}
      />,
    )

    expect(radios(element)).toHaveLength(0)
    expect(element.textContent).not.toContain('In use')
  })
})

describe('several keys of one provider', () => {
  it('lists all of them', async () => {
    const element = await render(
      <ProviderCard
        provider={ANTHROPIC}
        accounts={[
          keyAccount({ id: 'work', label: 'Work', keyHint: '4f2a' }),
          keyAccount({ id: 'ci', label: 'CI', keyHint: '90bd' }),
        ]}
        inUseId="work"
        signIn={signIn()}
        actions={actionsOf()}
      />,
    )

    expect(element.textContent).toContain('Work')
    expect(element.textContent).toContain('CI')
    expect(element.textContent).toContain('sk-ant-…90bd')
  })
})

describe('a key row without a key hint', () => {
  it('states only that it is an api key', async () => {
    const element = await render(
      <ProviderCard
        provider={ANTHROPIC}
        accounts={[keyAccount({ id: 'old', label: 'Old' })]}
        inUseId="old"
        signIn={signIn()}
        actions={actionsOf()}
      />,
    )

    expect(element.textContent).toContain('API key · Added Nov 3')
  })
})

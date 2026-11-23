import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import { EBrand } from '@dltech/atlas-ui/components/brand-mark'
import type { UsageReportDto, UsageReportInput } from '@dltech/atlas-protocol'

import { EAccountKind, type Account } from '../../data/personal/accounts-api'
import {
  EProviderSignInState,
  type ProviderSignInControl,
} from '../../data/personal/use-provider-sign-in'
import { EProviderId } from '../../fixtures/settings-agent'
import type { ProviderCard } from '../provider-logins-card'

const METERED: UsageReportDto = {
  accountId: null,
  label: 'dennis@byatlas.io',
  metered: true,
  fiveHour: { utilization: 68, resetsAt: null },
  sevenDay: null,
  fetchedAt: '2026-11-23T12:00:00.000Z',
}

const readings = new Map<string, UsageReportDto>()

mock.module('@/features/settings/data/personal/usage-api', () => ({
  fetchUsageReport: async (input: UsageReportInput): Promise<UsageReportDto> =>
    readings.get('accountId' in input ? input.accountId : input.provider) ?? {
      ...METERED,
      metered: false,
    },
  usageQueryKey: (input: UsageReportInput): string =>
    'accountId' in input ? `usage-account-${input.accountId}` : `usage-provider-${input.provider}`,
}))

const { ProviderLoginsCard } = await import('../provider-logins-card')

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
  readings.clear()
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

const CLAUDE: ProviderCard = {
  name: 'Claude',
  brand: EBrand.Claude,
  idleDescription: 'Use your Claude Pro or Max subscription.',
}

const login = (args: { id: string } & Partial<Account>): Account => ({
  id: args.id,
  provider: EProviderId.Anthropic,
  kind: EAccountKind.Oauth,
  label: 'Claude',
  status: 'active',
  createdAt: '2026-11-01T00:00:00.000Z',
  ...args,
})

const controller = (overrides: Partial<ProviderSignInControl> = {}): ProviderSignInControl => ({
  flow: { status: EProviderSignInState.Idle },
  start: () => {},
  cancel: () => {},
  submitCode: () => {},
  ...overrides,
})

const buttonsOf = (element: HTMLElement): HTMLButtonElement[] => [
  ...element.querySelectorAll('button'),
]

const labelOf = (button: HTMLButtonElement): string => (button.textContent ?? '').trim()

const click = async (button: HTMLButtonElement): Promise<void> => {
  await act(async () => button.click())
}

const buttonLabelled = (element: HTMLElement, label: string): HTMLButtonElement => {
  const found = buttonsOf(element).find((button) => labelOf(button) === label)
  if (found === undefined) throw new Error(`no button labelled ${label}`)
  return found
}

describe('a provider with no login', () => {
  it('offers to sign in', async () => {
    const element = await render(
      <ProviderLoginsCard
        provider={CLAUDE}
        logins={[]}
        activeId={null}
        busy={false}
        signIn={controller()}
        onSwitch={() => {}}
        onRemove={() => {}}
      />,
    )

    expect(element.textContent).toContain('Not connected')
    expect(buttonsOf(element).map(labelOf)).toEqual(['Sign in with Claude'])
  })
})

describe('a provider holding logins', () => {
  const twoLogins = [
    login({ id: 'first', email: 'one@example.com', subscription: 'Max 20x' }),
    login({ id: 'second', email: 'two@example.com', subscription: 'Pro' }),
  ]

  it('marks the login Atlas uses and offers signing it out', async () => {
    const element = await render(
      <ProviderLoginsCard
        provider={CLAUDE}
        logins={twoLogins}
        activeId="second"
        busy={false}
        signIn={controller()}
        onSwitch={() => {}}
        onRemove={() => {}}
      />,
    )

    expect(element.textContent).toContain('Active')
    expect(element.textContent).toContain('two@example.com')
    expect(element.textContent).toContain('one@example.com')
    expect(buttonsOf(element).map(labelOf)).toEqual([
      'Switch to',
      'Remove',
      'Sign out',
      'Add account',
    ])
  })

  it('switches to the login named by the row that was pressed', async () => {
    const switched: string[] = []
    const element = await render(
      <ProviderLoginsCard
        provider={CLAUDE}
        logins={twoLogins}
        activeId="second"
        busy={false}
        signIn={controller()}
        onSwitch={(accountId) => switched.push(accountId)}
        onRemove={() => {}}
      />,
    )

    await click(buttonLabelled(element, 'Switch to'))

    expect(switched).toEqual(['first'])
  })

  it('removes only the login named by the row that was pressed', async () => {
    const removed: string[] = []
    const element = await render(
      <ProviderLoginsCard
        provider={CLAUDE}
        logins={twoLogins}
        activeId="second"
        busy={false}
        signIn={controller()}
        onSwitch={() => {}}
        onRemove={(accountId) => removed.push(accountId)}
      />,
    )

    await click(buttonLabelled(element, 'Sign out'))

    expect(removed).toEqual(['second'])
  })

  it('shows each account the plan usage of its own reading', async () => {
    readings.set('first', { ...METERED, fiveHour: { utilization: 68, resetsAt: null } })
    readings.set('second', { ...METERED, fiveHour: { utilization: 12, resetsAt: null } })

    const element = await render(
      <ProviderLoginsCard
        provider={CLAUDE}
        logins={twoLogins}
        activeId="second"
        busy={false}
        signIn={controller()}
        onSwitch={() => {}}
        onRemove={() => {}}
      />,
    )

    expect(element.querySelectorAll('[aria-label="Plan usage"]')).toHaveLength(2)
    expect(element.textContent).toContain('68%')
    expect(element.textContent).toContain('12%')
  })

  it('shows no meter for an account the provider does not meter', async () => {
    const element = await render(
      <ProviderLoginsCard
        provider={CLAUDE}
        logins={twoLogins}
        activeId="second"
        busy={false}
        signIn={controller()}
        onSwitch={() => {}}
        onRemove={() => {}}
      />,
    )

    expect(element.querySelectorAll('[aria-label="Plan usage"]')).toHaveLength(0)
  })

  it('starts sign-in for another account', async () => {
    let started = 0
    const element = await render(
      <ProviderLoginsCard
        provider={CLAUDE}
        logins={twoLogins}
        activeId="second"
        busy={false}
        signIn={controller({ start: () => (started += 1) })}
        onSwitch={() => {}}
        onRemove={() => {}}
      />,
    )

    await click(buttonLabelled(element, 'Add account'))

    expect(started).toBe(1)
  })
})

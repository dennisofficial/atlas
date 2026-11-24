import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import type { UsageReportDto, UsageReportInput } from '@dltech/atlas-protocol'

import { EAccountKind, type Account } from '../../data/personal/accounts-api'
import { EProviderId } from '../../fixtures/settings-agent'

const accounts: Account[] = [
  {
    id: 'first',
    provider: EProviderId.Anthropic,
    kind: EAccountKind.Oauth,
    label: 'Claude',
    email: 'one@example.com',
    subscription: 'max',
    status: 'active',
    createdAt: '2026-11-01T00:00:00.000Z',
  },
  {
    id: 'second',
    provider: EProviderId.Anthropic,
    kind: EAccountKind.Oauth,
    label: 'Claude',
    email: 'two@example.com',
    subscription: 'pro',
    status: 'active',
    createdAt: '2026-11-02T00:00:00.000Z',
  },
  {
    id: 'key',
    provider: EProviderId.Anthropic,
    kind: EAccountKind.ApiKey,
    label: 'Work',
    keyHint: '4f2a',
    status: 'active',
    createdAt: '2026-11-03T00:00:00.000Z',
  },
  {
    id: 'ci',
    provider: EProviderId.Anthropic,
    kind: EAccountKind.ApiKey,
    label: 'CI',
    keyHint: '90bd',
    status: 'active',
    createdAt: '2026-11-04T00:00:00.000Z',
  },
]

const readingOf = (accountId: string, utilization: number): UsageReportDto => ({
  accountId,
  label: 'dennis@byatlas.io',
  metered: true,
  fiveHour: { utilization, resetsAt: null },
  sevenDay: null,
  fetchedAt: '2026-11-23T12:00:00.000Z',
})

mock.module('@/features/settings/data/personal/provider-accounts-query', () => ({
  ACCOUNTS_KEY: 'provider-logins',
  useProviderAccounts: () => ({
    state: 'ready',
    data: { accounts, active: { anthropic: 'first', openai: null } },
    error: undefined,
    reload: () => {},
  }),
}))

mock.module('@/features/settings/data/personal/usage-api', () => ({
  fetchUsageReport: async (input: UsageReportInput): Promise<UsageReportDto> => {
    const accountId = 'accountId' in input ? input.accountId : ''
    if (accountId === 'first') return readingOf(accountId, 68)
    if (accountId === 'second') return readingOf(accountId, 12)
    return { ...readingOf(accountId, 0), metered: false }
  },
  usageQueryKey: (input: UsageReportInput): string =>
    'accountId' in input ? `usage-account-${input.accountId}` : `usage-provider-${input.provider}`,
}))

const { ProvidersPage } = await import('../providers')

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

const labelled = (element: HTMLElement, name: string): HTMLElement[] => [
  ...element.querySelectorAll<HTMLElement>(`[aria-label="${name}"]`),
]

describe('ProvidersPage', () => {
  it('gives every plan account its own two readings', async () => {
    const element = await render(<ProvidersPage />)

    expect(element.textContent).toContain('68%')
    expect(element.textContent).toContain('12%')
  })

  it('shows no meter on a key row', async () => {
    const element = await render(<ProvidersPage />)

    const fiveHourLabels = [...element.querySelectorAll('span')].filter(
      (span) => span.textContent === '5-hour',
    )
    expect(element.textContent).toContain('Work')
    expect(fiveHourLabels).toHaveLength(2)
  })

  it('lists every account of a provider in one card', async () => {
    const element = await render(<ProvidersPage />)

    expect(labelled(element, 'Anthropic account in use')).toHaveLength(1)
    expect(element.textContent).toContain('one@example.com')
    expect(element.textContent).toContain('two@example.com')
    expect(element.textContent).toContain('CI')
    expect(element.textContent).toContain('sk-ant-…90bd')
  })

  it('lists providers with no account under Add a provider', async () => {
    const element = await render(<ProvidersPage />)

    expect(element.textContent).toContain('Add a provider')
    expect(element.textContent).toContain('OpenRouter')
    expect(element.textContent).toContain('Inference.net')
    expect(element.textContent).toContain('Vercel AI Gateway')
  })
})

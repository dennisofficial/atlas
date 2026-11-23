import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, type ReactNode } from 'react'
import type { Root } from 'react-dom/client'

import type { SessionModelChoice, UsageReportDto, UsageReportInput } from '@dltech/atlas-protocol'

const calls: UsageReportInput[] = []
let reported: UsageReportDto | null = null

const METERED: UsageReportDto = {
  accountId: 'acc_1',
  label: 'dennis@byatlas.io',
  metered: true,
  fiveHour: { utilization: 68, resetsAt: '2026-11-23T12:42:00.000Z' },
  sevenDay: { utilization: 41, resetsAt: null },
  fetchedAt: '2026-11-23T12:00:00.000Z',
}

mock.module('@/features/settings/data/personal/usage-api', () => ({
  fetchUsageReport: async (input: UsageReportInput): Promise<UsageReportDto> => {
    calls.push(input)
    return reported ?? METERED
  },
  usageQueryKey: (input: UsageReportInput): string =>
    'accountId' in input ? `usage-account-${input.accountId}` : `usage-provider-${input.provider}`,
}))

const { SessionUsage } = await import('../session-usage')

const CLAUDE: SessionModelChoice = { ref: 'anthropic/claude-opus-4-5', effort: 'high', fast: false }
const UNKNOWN: SessionModelChoice = { ref: 'nowhere/some-model', effort: 'high', fast: false }

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
  calls.length = 0
  reported = null
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

describe('SessionUsage', () => {
  it('reads the plan usage of the provider the session runs on', async () => {
    const element = await render(<SessionUsage model={CLAUDE} working={false} />)

    expect(calls).toEqual([{ provider: 'anthropic' }])
    expect(element.textContent).toContain('5h 68%')
    expect(element.textContent).toContain('7d 41%')
  })

  it('asks nothing for a model no plan account backs', async () => {
    const element = await render(<SessionUsage model={UNKNOWN} working={false} />)

    expect(calls).toHaveLength(0)
    expect(element.innerHTML).toBe('')
  })

  it('reads one quiet line', async () => {
    const element = await render(<SessionUsage model={CLAUDE} working={false} />)

    const trigger = element.querySelector('[aria-label^="Plan usage"]')
    expect(trigger?.textContent).toBe('5h 68% · 7d 41%')
  })

  it('hides the 5-hour window of a plan that has only a weekly limit', async () => {
    reported = { ...METERED, fiveHour: null }
    const element = await render(<SessionUsage model={CLAUDE} working={false} />)

    const trigger = element.querySelector('[aria-label^="Plan usage"]')
    expect(trigger?.textContent).toBe('7d 41%')
    expect(trigger?.getAttribute('aria-label')).toBe('Plan usage: 7-day 41%')
  })
})

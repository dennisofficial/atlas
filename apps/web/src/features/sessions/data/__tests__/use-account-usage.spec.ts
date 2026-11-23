import { mock } from 'bun:test'

import type { UsageReportDto, UsageReportInput } from '@dltech/atlas-protocol'

const calls: UsageReportInput[] = []

const report: UsageReportDto = {
  accountId: 'acc_1',
  label: 'dennis@byatlas.io',
  metered: true,
  fiveHour: { utilization: 12, resetsAt: null },
  sevenDay: null,
  fetchedAt: '2026-11-23T12:00:00.000Z',
}

const usageApi = {
  fetchUsageReport: async (input: UsageReportInput): Promise<UsageReportDto> => {
    calls.push(input)
    return report
  },
  usageQueryKey: (input: UsageReportInput): string =>
    'accountId' in input ? `usage-account-${input.accountId}` : `usage-provider-${input.provider}`,
}

mock.module('@/features/settings/data/personal/usage-api', () => usageApi)

const { registerDom, unregisterDom } = await import('@/lib/__tests__/happy-dom-globals')
const { afterAll, afterEach, beforeAll, describe, expect, it } = await import('bun:test')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { act, createElement } = await import('react')
const { useAccountUsage } = await import('../use-account-usage')

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const settle = async (): Promise<void> => {
  await act(async () => {
    await sleep(0)
  })
}

type Seen = { report: UsageReportDto | null }

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(() => {
  calls.length = 0
  document.body.innerHTML = ''
})

type ProbeProps = { input: UsageReportInput | null; turnEnds: number }

function Probe(props: ProbeProps & { seen: Seen }): null {
  const usage = useAccountUsage({ input: props.input, turnEnds: props.turnEnds })
  props.seen.report = usage.report
  return null
}

const mount = async (props: ProbeProps) => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const seen: Seen = { report: null }
  const tree = (next: ProbeProps) =>
    createElement(
      QueryClientProvider,
      { client },
      createElement(Probe, { input: next.input, turnEnds: next.turnEnds, seen }),
    )
  let root: ReturnType<typeof createRoot> | undefined
  await act(async () => {
    root = createRoot(container)
    root.render(tree(props))
  })
  await settle()
  return {
    seen,
    rerender: async (next: ProbeProps) => {
      await act(async () => root?.render(tree(next)))
    },
    unmount: async () => {
      await act(async () => root?.unmount())
    },
  }
}

describe('useAccountUsage', () => {
  it('reads the report once per mount', async () => {
    const { seen, unmount } = await mount({ input: { accountId: 'acc_1' }, turnEnds: 0 })

    expect(calls).toEqual([{ accountId: 'acc_1' }])
    expect(seen.report?.fiveHour?.utilization).toBe(12)
    await unmount()
  })

  it('refetches once per finished turn and nothing else', async () => {
    const { rerender, unmount } = await mount({ input: { accountId: 'acc_1' }, turnEnds: 0 })
    expect(calls).toHaveLength(1)

    await rerender({ input: { accountId: 'acc_1' }, turnEnds: 1 })
    expect(calls).toHaveLength(2)

    await rerender({ input: { accountId: 'acc_1' }, turnEnds: 1 })
    expect(calls).toHaveLength(2)

    await act(async () => {
      await sleep(120)
    })
    expect(calls).toHaveLength(2)

    await rerender({ input: { accountId: 'acc_1' }, turnEnds: 2 })
    expect(calls).toHaveLength(3)
    await unmount()
  })

  it('sends nothing when there is no account or provider to ask about', async () => {
    const { seen, unmount } = await mount({ input: null, turnEnds: 0 })

    expect(calls).toHaveLength(0)
    expect(seen.report).toBeNull()
    await unmount()
  })
})

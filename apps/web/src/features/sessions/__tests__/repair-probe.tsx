import { mock } from 'bun:test'
import * as realNavigation from 'next/navigation'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { chainEvents, toRunId, toThreadId, type V2Body, type V2Event } from '@dltech/atlas-core'

import { TestQueryProvider, createTestQueryClient } from '@/lib/__tests__/query-test-provider'

import type { CredentialRepairControl } from '../data/use-credential-repair'

export const MAIN = toThreadId('thread-1')
export const CHILD = toThreadId('agent-1')

export type RepairAccount = {
  id: string
  provider: string
  kind: string
  label: string
  status: string
  createdAt: string
}

export const accounts: RepairAccount[] = [
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

export const replaced: { accountId: string; apiKey: string }[] = []
export const activated: { provider: string; accountId: string }[] = []
export const retried: unknown[] = []
export const errors: string[] = []
export const pushed: string[] = []
export const counters = { switched: 0, opened: 0 }
export const state = { replaceFails: false }

mock.module('@/features/settings/data/personal/accounts-api', () => ({
  fetchAccounts: async () => accounts,
  replaceApiKey: async (args: { accountId: string; apiKey: string }) => {
    if (state.replaceFails) throw new Error('the key was refused')
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

mock.module('next/navigation', () => ({
  ...realNavigation,
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
}))

export const eventsOf = (bodies: readonly V2Body[]): V2Event[] =>
  chainEvents({
    threadId: MAIN,
    runId: toRunId('run-1'),
    epoch: 1,
    at: '2026-11-23T10:00:00.000Z',
    from: undefined,
    bodies,
  })

export const resetProbe = (): void => {
  replaced.length = 0
  activated.length = 0
  retried.length = 0
  errors.length = 0
  pushed.length = 0
  counters.switched = 0
  counters.opened = 0
  state.replaceFails = false
  const primary = accounts[0]
  if (primary !== undefined) primary.kind = 'api-key'
}

let root: Root | null = null
let latest: CredentialRepairControl | null = null

export const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

export async function mountRepair(args: {
  events: readonly V2Event[]
  onSwitchModel: () => void
}): Promise<void> {
  const { useCredentialRepair } = await import('../data/use-credential-repair')
  if (root !== null) {
    const previous = root
    root = null
    await act(async () => previous.unmount())
  }
  const { createRoot } = await import('react-dom/client')
  const mounted = createRoot(document.createElement('div'))
  root = mounted
  function Probe() {
    latest = useCredentialRepair({
      sessionId: 's1',
      mainThreadId: 'thread-1',
      events: args.events,
      onSwitchModel: args.onSwitchModel,
    })
    return <p>{latest.strip?.title ?? ''}</p>
  }
  await act(async () =>
    mounted.render(
      <TestQueryProvider client={createTestQueryClient()}>
        <Probe />
      </TestQueryProvider>,
    ),
  )
  await flush()
  await flush()
}

export const controlOf = (): CredentialRepairControl => {
  if (latest === null) throw new Error('expected a mounted control')
  return latest
}

export const unmountRepair = async (): Promise<void> => {
  await act(async () => root?.unmount())
  root = null
  latest = null
}

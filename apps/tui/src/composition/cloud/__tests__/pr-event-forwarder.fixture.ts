import { EExecutionLocation, EPrEventKind, toThreadId, type ThreadId } from '@dltech/atlas-core'
import {
  ECloudSandboxState,
  type CloudChannel,
  type PrEventFrame,
  type ThreadSummary,
} from '@dltech/atlas-harness'

import { createPrEventForwarder } from '../pr-event-forwarder'

export const CLOUD_THREAD = toThreadId('thread-cloud-parked')
export const LOCAL_THREAD = toThreadId('thread-local-active')

export const frame = (over: Partial<PrEventFrame> = {}): PrEventFrame => ({
  id: 'evt_1',
  repoFullName: 'owner/repo',
  prNumber: 42,
  kind: EPrEventKind.Comment,
  payload: { url: 'https://github.com/owner/repo/pull/42', authorLogin: 'dennis', body: 'hello' },
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

type SubscriptionSeed = { provider?: string; repo: string; number: number; status?: string }

export const summary = (args: {
  id: ThreadId
  location: EExecutionLocation
  subscriptions?: SubscriptionSeed[]
}): ThreadSummary =>
  ({
    id: args.id,
    head: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    workspace: '/work',
    repo: 'github.com/owner/repo',
    executionLocation: args.location,
    ...(args.subscriptions === undefined
      ? {}
      : {
          subscriptions: args.subscriptions.map((seed) => ({
            provider: seed.provider ?? 'github.pull-request',
            target: { repo: seed.repo, number: seed.number },
            status: seed.status ?? 'active',
          })),
        }),
  }) as ThreadSummary

type Sent = { threadId: ThreadId; text: string }

export function rig(args: {
  summaries: readonly ThreadSummary[]
  sandboxState?: ECloudSandboxState | undefined
  activeThreadId?: ThreadId | undefined
}) {
  const sent: Sent[] = []
  const attached = new Set<ThreadId>()
  const channel = (threadId: ThreadId): CloudChannel =>
    ({
      threadId,
      send: ({ text }: { text: string }) => {
        sent.push({ threadId, text })
      },
    }) as unknown as CloudChannel

  const bridge = () => ({
    attach: ({ threadId }: { threadId: ThreadId }) => {
      attached.add(threadId)
      return { channel: channel(threadId), stores: {} as never }
    },
    sandboxes: {
      find: async () =>
        args.sandboxState === undefined
          ? undefined
          : { state: args.sandboxState, url: undefined, sandboxSessionId: undefined },
    },
  })

  const forwarder = createPrEventForwarder({
    listThreads: async () => args.summaries,
    project: 'project',
    bridge: bridge as never,
    activeThreadId: () => args.activeThreadId,
  })

  return { forwarder, sent, attached }
}

import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, EPrEventKind, toThreadId, type ThreadId } from '@dltech/atlas-core'
import { ECloudSandboxState, type CloudChannel, type PrEventFrame, type ThreadSummary } from '@dltech/atlas-harness'

import { createPrEventForwarder } from '../pr-event-forwarder'

const CLOUD_THREAD = toThreadId('thread-cloud-parked')
const LOCAL_THREAD = toThreadId('thread-local-active')

const frame = (over: Partial<PrEventFrame> = {}): PrEventFrame => ({
  id: 'evt_1',
  repoFullName: 'owner/repo',
  prNumber: 42,
  kind: EPrEventKind.Comment,
  payload: { url: 'https://github.com/owner/repo/pull/42', authorLogin: 'dennis', body: 'hello' },
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const summary = (args: {
  id: ThreadId
  location: EExecutionLocation
  pullRequests?: { repo: string; number: number }[]
}): ThreadSummary =>
  ({
    id: args.id,
    head: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    workspace: '/work',
    repo: 'github.com/owner/repo',
    executionLocation: args.location,
    ...(args.pullRequests === undefined
      ? {}
      : {
          pullRequests: args.pullRequests.map((p) => ({
            number: p.number,
            url: `https://${p.repo.replace('github.com/', 'github.com/')}/pull/${p.number}`,
            repo: p.repo,
            branch: 'main',
          })),
        }),
  }) as ThreadSummary

type Sent = { threadId: ThreadId; text: string }

function rig(args: {
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

describe('parked-cloud pr-event forwarding', () => {
  it('forwards a matching event into a parked cloud conversation as input', async () => {
    const { forwarder, sent } = rig({
      summaries: [
        summary({
          id: CLOUD_THREAD,
          location: EExecutionLocation.Cloud,
          pullRequests: [{ repo: 'github.com/owner/repo', number: 42 }],
        }),
      ],
      sandboxState: ECloudSandboxState.Parked,
      activeThreadId: LOCAL_THREAD,
    })

    await forwarder.onPrEvent(frame())

    expect(sent).toHaveLength(1)
    expect(sent[0]?.threadId).toBe(CLOUD_THREAD)
    expect(sent[0]?.text).toContain('PR #42')
    expect(sent[0]?.text).toContain('github.com/owner/repo')
    expect(sent[0]?.text).toContain('hello')
  })

  it('never forwards to a running sandbox — its own session consumes the frame natively', async () => {
    const { forwarder, sent } = rig({
      summaries: [
        summary({
          id: CLOUD_THREAD,
          location: EExecutionLocation.Cloud,
          pullRequests: [{ repo: 'github.com/owner/repo', number: 42 }],
        }),
      ],
      sandboxState: ECloudSandboxState.Running,
      activeThreadId: LOCAL_THREAD,
    })

    await forwarder.onPrEvent(frame())

    expect(sent).toHaveLength(0)
  })

  it('forwards when the sandbox is gone entirely — nothing is there to consume it', async () => {
    const { forwarder, sent } = rig({
      summaries: [
        summary({
          id: CLOUD_THREAD,
          location: EExecutionLocation.Cloud,
          pullRequests: [{ repo: 'github.com/owner/repo', number: 42 }],
        }),
      ],
      sandboxState: undefined,
      activeThreadId: LOCAL_THREAD,
    })

    await forwarder.onPrEvent(frame())

    expect(sent).toHaveLength(1)
  })

  it('ignores a local conversation — its own harness routing owns the frame', async () => {
    const { forwarder, sent, attached } = rig({
      summaries: [
        summary({
          id: LOCAL_THREAD,
          location: EExecutionLocation.Host,
          pullRequests: [{ repo: 'github.com/owner/repo', number: 42 }],
        }),
      ],
      sandboxState: ECloudSandboxState.Parked,
      activeThreadId: LOCAL_THREAD,
    })

    await forwarder.onPrEvent(frame())

    expect(sent).toHaveLength(0)
    expect(attached.size).toBe(0)
  })

  it('skips the active conversation even when it sits in the cloud', async () => {
    const { forwarder, sent } = rig({
      summaries: [
        summary({
          id: CLOUD_THREAD,
          location: EExecutionLocation.Cloud,
          pullRequests: [{ repo: 'github.com/owner/repo', number: 42 }],
        }),
      ],
      sandboxState: ECloudSandboxState.Parked,
      activeThreadId: CLOUD_THREAD,
    })

    await forwarder.onPrEvent(frame())

    expect(sent).toHaveLength(0)
  })

  it('ignores an event for a pull request no cloud thread watches', async () => {
    const { forwarder, sent } = rig({
      summaries: [
        summary({
          id: CLOUD_THREAD,
          location: EExecutionLocation.Cloud,
          pullRequests: [{ repo: 'github.com/owner/repo', number: 7 }],
        }),
      ],
      sandboxState: ECloudSandboxState.Parked,
      activeThreadId: LOCAL_THREAD,
    })

    await forwarder.onPrEvent(frame())

    expect(sent).toHaveLength(0)
  })

  it('ignores an event for a repo no cloud thread watches', async () => {
    const { forwarder, sent } = rig({
      summaries: [
        summary({
          id: CLOUD_THREAD,
          location: EExecutionLocation.Cloud,
          pullRequests: [{ repo: 'github.com/elsewhere/other', number: 42 }],
        }),
      ],
      sandboxState: ECloudSandboxState.Parked,
      activeThreadId: LOCAL_THREAD,
    })

    await forwarder.onPrEvent(frame())

    expect(sent).toHaveLength(0)
  })

  it('reuses one channel for repeated events to the same thread', async () => {
    const { forwarder, attached } = rig({
      summaries: [
        summary({
          id: CLOUD_THREAD,
          location: EExecutionLocation.Cloud,
          pullRequests: [{ repo: 'github.com/owner/repo', number: 42 }],
        }),
      ],
      sandboxState: ECloudSandboxState.Parked,
      activeThreadId: LOCAL_THREAD,
    })

    await forwarder.onPrEvent(frame())
    await forwarder.onPrEvent(frame({ id: 'evt_2' }))

    expect(attached.size).toBe(1)
  })
})

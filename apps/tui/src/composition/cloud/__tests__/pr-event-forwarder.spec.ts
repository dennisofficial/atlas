import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '@dltech/atlas-core'
import { ECloudSandboxState } from '@dltech/atlas-harness'

import { CLOUD_THREAD, frame, LOCAL_THREAD, rig, summary } from './pr-event-forwarder.fixture'

describe('parked-cloud pr-event forwarding', () => {
  it('forwards a matching event into a parked cloud conversation as input', async () => {
    const { forwarder, sent } = rig({
      summaries: [
        summary({
          id: CLOUD_THREAD,
          location: EExecutionLocation.Cloud,
          subscriptions: [{ repo: 'github.com/owner/repo', number: 42 }],
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
          subscriptions: [{ repo: 'github.com/owner/repo', number: 42 }],
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
          subscriptions: [{ repo: 'github.com/owner/repo', number: 42 }],
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
          subscriptions: [{ repo: 'github.com/owner/repo', number: 42 }],
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
          subscriptions: [{ repo: 'github.com/owner/repo', number: 42 }],
        }),
      ],
      sandboxState: ECloudSandboxState.Parked,
      activeThreadId: CLOUD_THREAD,
    })

    await forwarder.onPrEvent(frame())

    expect(sent).toHaveLength(0)
  })

  it('ignores an event for a pull request no cloud thread subscribes to', async () => {
    const { forwarder, sent } = rig({
      summaries: [
        summary({
          id: CLOUD_THREAD,
          location: EExecutionLocation.Cloud,
          subscriptions: [{ repo: 'github.com/owner/repo', number: 7 }],
        }),
      ],
      sandboxState: ECloudSandboxState.Parked,
      activeThreadId: LOCAL_THREAD,
    })

    await forwarder.onPrEvent(frame())

    expect(sent).toHaveLength(0)
  })

  it('ignores an event for a repo no cloud thread subscribes to', async () => {
    const { forwarder, sent } = rig({
      summaries: [
        summary({
          id: CLOUD_THREAD,
          location: EExecutionLocation.Cloud,
          subscriptions: [{ repo: 'github.com/elsewhere/other', number: 42 }],
        }),
      ],
      sandboxState: ECloudSandboxState.Parked,
      activeThreadId: LOCAL_THREAD,
    })

    await forwarder.onPrEvent(frame())

    expect(sent).toHaveLength(0)
  })

  it('forwards nothing to a thread whose summary carries no subscriptions', async () => {
    const { forwarder, sent } = rig({
      summaries: [summary({ id: CLOUD_THREAD, location: EExecutionLocation.Cloud })],
      sandboxState: ECloudSandboxState.Parked,
      activeThreadId: LOCAL_THREAD,
    })

    await forwarder.onPrEvent(frame())

    expect(sent).toHaveLength(0)
  })

  it('forwards nothing to a thread whose subscription is paused', async () => {
    const { forwarder, sent } = rig({
      summaries: [
        summary({
          id: CLOUD_THREAD,
          location: EExecutionLocation.Cloud,
          subscriptions: [{ repo: 'github.com/owner/repo', number: 42, status: 'paused' }],
        }),
      ],
      sandboxState: ECloudSandboxState.Parked,
      activeThreadId: LOCAL_THREAD,
    })

    await forwarder.onPrEvent(frame())

    expect(sent).toHaveLength(0)
  })

  it('forwards nothing when the subscription belongs to another provider', async () => {
    const { forwarder, sent } = rig({
      summaries: [
        summary({
          id: CLOUD_THREAD,
          location: EExecutionLocation.Cloud,
          subscriptions: [{ provider: 'linear.issue', repo: 'github.com/owner/repo', number: 42 }],
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
          subscriptions: [{ repo: 'github.com/owner/repo', number: 42 }],
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

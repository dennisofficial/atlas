import { describe, expect, it } from 'bun:test'
import { RemoteSessionActivity } from '../../activity/remote-session-activity'

import type { Event, ThreadId } from '@dltech/atlas-core'
import { harness, THREAD } from '@dltech/atlas-client/channel-fixture'
import { SANDBOX_WORKSPACE_PATH } from '@dltech/atlas-wire'

import { EClientRequest } from '../../cloud/channel-wire'
import type { CloudBridge, CloudSandbox } from '../../cloud/cloud-bridge'
import { RemoteEventLog } from '../../cloud/remote-event-log'
import { RemoteThreadStore } from '../../cloud/remote-thread-store'
import { RemoteTurnLedger } from '../../cloud/remote-turn-ledger'
import { openPodThread, assemblePodThread } from '../pod-thread'
import { recordingNarration, recordingNotices, RUNNING_POD } from './pod-fakes'

type RenameListener = (renamed: { threadId: ThreadId; title: string }) => void

const podRig = (args: { createFails?: Error | undefined; homeProject?: string | null } = {}) => {
  const order: string[] = []
  const created: { threadId: ThreadId; projectId: string | null }[] = []
  const renamedHome: { threadId: ThreadId; title: string }[] = []
  let pushRename: RenameListener = () => undefined
  const live = harness()
  const remoteThreads = new RemoteThreadStore({
    channel: {
      request: async (call: { op: EClientRequest }) =>
        call.op === EClientRequest.ReadThread ? { thread: null } : {},
      onThreadRenamed: (listener) => {
        pushRename = listener
        return () => {
          pushRename = () => undefined
        }
      },
      onThreadModelChanged: () => () => undefined,
    },
  })
  const bridge: CloudBridge = {
    sandboxes: {
      create: async (call): Promise<CloudSandbox> => {
        order.push('create')
        created.push({ threadId: call.threadId, projectId: call.projectId })
        if (args.createFails !== undefined) throw args.createFails
        return RUNNING_POD
      },
      find: async () => undefined,
      readResources: async () => ({}),
      updateResources: async () => {
        throw new Error('not resized in this spec')
      },
      destroy: async () => undefined,
    },
    messages: { send: async () => undefined },
    attach: (call) => {
      order.push(`attach:${call.url ?? 'deferred'}`)
      return {
        channel: live.channel,
        stores: {
          log: new RemoteEventLog({ channel: live.channel }),
          threads: remoteThreads,
          ledger: new RemoteTurnLedger({ channel: live.channel }),
          activity: new RemoteSessionActivity({ channel: live.channel }),
        },
      }
    },
  }
  const home = {
    find: async () =>
      args.homeProject === undefined ? undefined : { projectId: args.homeProject },
    rename: async (renamed: { threadId: ThreadId; title: string }) => {
      renamedHome.push(renamed)
    },
  }
  let cancelled = 0
  const readiness = {
    applied: () => null,
    subscribe: () => () => undefined,
    cancelWaiting: () => {
      cancelled += 1
    },
  }
  return {
    bridge,
    home,
    live,
    order,
    created,
    renamedHome,
    readiness,
    cancelled: () => cancelled,
    rename: (renamed: { threadId: ThreadId; title: string }) => pushRename(renamed),
  }
}

const opened = { events: [] as readonly Event[] }

const portsOf = (rig: ReturnType<typeof podRig>) => ({
  bridge: rig.bridge,
  threadId: THREAD,
  home: rig.home,
  notice: recordingNotices(),
  onReload: async () => undefined,
  open: async () => opened,
  readinessOf: () => rig.readiness,
})

describe('opening a pod thread awake', () => {
  it('wakes the pod on the home project before attaching to its url', async () => {
    const rig = podRig({ homeProject: 'proj_home' })

    const pod = await openPodThread(portsOf(rig))

    expect(rig.order).toEqual(['create', `attach:${RUNNING_POD.url}`])
    expect(rig.created).toEqual([{ threadId: THREAD, projectId: 'proj_home' }])
    expect(pod.opened).toBe(opened)
    pod.close()
  })

  it('anchors a thread the pod does not describe at the sandbox workspace', async () => {
    const pod = await openPodThread(portsOf(podRig()))

    expect(pod.anchor).toEqual({ workspace: SANDBOX_WORKSPACE_PATH, repo: null })
    pod.close()
  })

  it('narrates the open wake through to settled', async () => {
    const narration = recordingNarration()

    const pod = await openPodThread({ ...portsOf(podRig()), openNarration: narration })

    expect(narration.calls).toEqual(['begin', 'attaching', 'settled'])
    pod.close()
  })

  it('narrates the failure and rejects when the pod cannot be woken', async () => {
    const narration = recordingNarration()
    const rig = podRig({ createFails: new Error('docker is not running') })

    await expect(openPodThread({ ...portsOf(rig), openNarration: narration })).rejects.toThrow(
      'docker is not running',
    )

    expect(narration.calls).toEqual(['begin', 'failed:docker is not running'])
    expect(rig.order).toEqual(['create'])
  })

  it('has nothing left to settle after an awake open', async () => {
    const rig = podRig()
    const pod = await openPodThread(portsOf(rig))

    pod.settleOpen()

    expect(rig.created).toHaveLength(1)
    pod.close()
  })
})

describe('a held pod thread', () => {
  it('carries a rename the pod announces into the home store', async () => {
    const rig = podRig()
    const pod = await openPodThread(portsOf(rig))

    rig.rename({ threadId: THREAD, title: 'Atlas Repository Setup' })
    await Promise.resolve()

    expect(rig.renamedHome).toEqual([{ threadId: THREAD, title: 'Atlas Repository Setup' }])
    pod.close()
  })

  it('closes the channel, drops waiting readers and stops mirroring renames on close', async () => {
    const rig = podRig()
    const pod = await openPodThread(portsOf(rig))

    pod.close()
    rig.rename({ threadId: THREAD, title: 'too late' })
    await Promise.resolve()

    expect(rig.live.live().closed).toBe(true)
    expect(rig.cancelled()).toBe(1)
    expect(rig.renamedHome).toEqual([])
  })

  it('is abandoned before anything is held when the caller no longer wants it', async () => {
    const rig = podRig()
    const attachment = rig.bridge.attach({ threadId: THREAD })

    await expect(
      assemblePodThread({
        ...portsOf(rig),
        attachment,
        projectId: null,
        assertStillWanted: () => {
          throw new Error('cancelled')
        },
      }),
    ).rejects.toThrow('cancelled')

    rig.rename({ threadId: THREAD, title: 'unheld' })
    await Promise.resolve()
    expect(rig.renamedHome).toEqual([])
  })
})

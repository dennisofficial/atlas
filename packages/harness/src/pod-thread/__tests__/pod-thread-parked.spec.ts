import { afterEach, describe, expect, it } from 'bun:test'
import { RemoteSessionActivity } from '../../activity/remote-session-activity'
import { unavailableActivity } from '../../composition/__tests__/fakes'

import { toRunId, type Event, type ThreadId } from '@dltech/atlas-core'
import { harness, THREAD } from '@dltech/atlas-client/channel-fixture'

import {
  ECloudSandboxState,
  type CloudBridge,
  type CloudSandboxStatus,
} from '../../cloud/cloud-bridge'
import { EConnectionView } from '../../cloud/connection-view'
import { RemoteEventLog } from '../../cloud/remote-event-log'
import { RemoteThreadStore } from '../../cloud/remote-thread-store'
import { RemoteTurnLedger } from '../../cloud/remote-turn-ledger'
import { JsonlTurnLedger } from '../../ledger/jsonl/jsonl-turn-ledger'
import { SessionRegistry } from '../../store/sessions/registry'
import { openStoreFixture, type StoreFixture } from '../../store/__tests__/harness'
import { NoLocalPodCopyError, openParkedPodThread } from '../pod-thread-parked'
import { recordingNotices, RUNNING_POD } from './pod-fakes'

const fixtures: StoreFixture[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

const tick = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

const parkedRig = (status: CloudSandboxStatus | undefined) => {
  const fixture = openStoreFixture()
  fixtures.push(fixture)
  const created: ThreadId[] = []
  const attached: (string | undefined)[] = []
  let wakes = 0
  const live = harness({
    unattached: true,
    readsWake: false,
    wakeSandbox: () => {
      wakes += 1
      return new Promise(() => undefined)
    },
  })
  const bridge: CloudBridge = {
    sandboxes: {
      create: async (call) => {
        created.push(call.threadId)
        return RUNNING_POD
      },
      find: async () => status,
      readResources: async () => ({}),
      updateResources: async () => {
        throw new Error('not resized in this spec')
      },
      destroy: async () => undefined,
    },
    attach: (call) => {
      attached.push(call.url)
      return {
        channel: live.channel,
        stores: {
          log: new RemoteEventLog({ channel: live.channel }),
          threads: new RemoteThreadStore({ channel: live.channel }),
          ledger: new RemoteTurnLedger({ channel: live.channel }),
          activity: new RemoteSessionActivity({ channel: live.channel }),
        },
      }
    },
  }
  const ports = {
    bridge,
    threadId: THREAD,
    home: fixture.threads,
    notice: recordingNotices(),
    onReload: async () => undefined,
    open: async (runtime: {
      log: { read(args: { threadId: ThreadId }): Promise<Event[]> }
    }): Promise<{ events: readonly Event[] }> => ({
      events: await runtime.log.read({ threadId: THREAD }),
    }),
    local: {
      activity: unavailableActivity(),
      log: fixture.log,
      threads: fixture.threads,
      ledger: new JsonlTurnLedger({
        home: fixture.home,
        registry: new SessionRegistry(fixture.home),
      }),
    },
  }
  return { fixture, ports, live, created, attached, wakes: () => wakes }
}

const seedLocal = async (fixture: StoreFixture): Promise<void> => {
  await fixture.threads.create({ id: THREAD, workspace: '/w', repo: null })
  await fixture.log.append({
    threadId: THREAD,
    runId: toRunId('local-run'),
    drafts: [{ type: 'user-said', text: 'from disk' }],
  })
}

describe('opening a parked pod thread from its local copy', () => {
  it('opens from disk against a parked channel without waking the pod', async () => {
    const rig = parkedRig({ state: ECloudSandboxState.Stopped, checkpoint: null })
    await seedLocal(rig.fixture)

    const pod = await openParkedPodThread(rig.ports)
    await tick()

    expect(pod.opened.events).toHaveLength(1)
    expect(rig.attached).toEqual([undefined])
    expect(rig.created).toEqual([])
    expect(rig.wakes()).toBe(0)
    expect(pod.attachment.channel.connection().state).toBe(EConnectionView.Parked)
    pod.close()
  })

  it('stays asleep on settle when the pod container is stopped', async () => {
    const rig = parkedRig({ state: ECloudSandboxState.Stopped, checkpoint: null })
    await seedLocal(rig.fixture)
    const pod = await openParkedPodThread(rig.ports)

    pod.settleOpen()
    await tick()

    expect(rig.wakes()).toBe(0)
    pod.close()
  })

  it('refuses when this machine holds no copy of the thread', async () => {
    const rig = parkedRig(undefined)

    await expect(openParkedPodThread(rig.ports)).rejects.toBeInstanceOf(NoLocalPodCopyError)
    expect(rig.attached).toEqual([])
  })
})

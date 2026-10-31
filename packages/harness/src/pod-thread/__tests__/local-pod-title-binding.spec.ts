import { afterEach, describe, expect, it } from 'bun:test'
import { toRunId } from '@dltech/atlas-core'
import { readied, THREAD } from '@dltech/atlas-client/channel-fixture'

import { EClientRequest, EServeFrame } from '../../cloud/channel-wire'
import { ECloudSandboxState, type CloudBridge } from '../../cloud/cloud-bridge'
import { RemoteThreadStore } from '../../cloud/remote-thread-store'
import { JsonlTurnLedger } from '../../ledger/jsonl/jsonl-turn-ledger'
import { registryFor } from '../../store/sessions/registry'
import { FileLocalThreadTitles } from '../../store/sessions/local-thread-titles'
import { openStoreFixture, type StoreFixture } from '../../store/__tests__/harness'
import { assemblePodThread } from '../pod-thread'
import { recordingNotices, RUNNING_POD } from './pod-fakes'

const fixtures: StoreFixture[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

describe('local title authority in an assembled pod thread', () => {
  it('replaces both raw title mirrors without changing the home user title', async () => {
    const home = openStoreFixture()
    fixtures.push(home)
    await home.threads.create({ id: THREAD, workspace: '/w', repo: null })
    await home.log.append({
      threadId: THREAD,
      runId: toRunId('run_1'),
      drafts: [{ type: 'user-said', text: 'hello' }],
    })
    const authority = new FileLocalThreadTitles({ home: home.home })
    await authority.renameUser({ threadId: THREAD, title: 'Authoritative name' })
    const live = readied()
    const old = {
      id: THREAD,
      title: 'Old pod name',
      head: 1,
      createdAt: '2026-10-31T00:00:00.000Z',
      updatedAt: '2026-10-31T00:00:00.000Z',
      workspace: '/w',
      repo: null,
    }
    const reply = async (request: { op: EClientRequest; params: unknown }): Promise<unknown> =>
      request.op === EClientRequest.ReadThread ? { thread: old } : {}
    live.channel.request = reply
    live.channel.requestIfConnected = reply
    const attachment = {
      channel: live.channel,
      stores: {
        log: home.log,
        threads: new RemoteThreadStore({ channel: live.channel }),
        ledger: new JsonlTurnLedger({
          home: home.home,
          registry: registryFor({ home: home.home }),
        }),
      },
    }
    const bridge: CloudBridge = {
      attach: () => attachment,
      sandboxes: {
        create: async () => RUNNING_POD,
        find: async () => ({ state: ECloudSandboxState.Running }),
        readResources: async () => ({}),
        updateResources: async () => {
          throw new Error('not resized')
        },
        destroy: async () => undefined,
      },
    }
    const pod = await assemblePodThread({
      bridge,
      threadId: THREAD,
      attachment,
      projectId: null,
      home: home.threads,
      notice: recordingNotices(),
      onReload: async () => undefined,
      transcript: { ...attachment.stores, threads: home.threads },
      localCopy: { home: home.home, threads: home.threads, log: home.log },
      open: async () => ({ events: await home.log.read({ threadId: THREAD }) }),
    })
    await pod.copySettled()
    live.receive({ kind: EServeFrame.ThreadRenamed, threadId: THREAD, title: 'Delayed old title' })
    await pod.copySettled()

    expect((await authority.read({ threadId: THREAD })).title).toBe('Authoritative name')
    expect((await home.threads.find({ threadId: THREAD }))?.title).toBe('Authoritative name')
    pod.close()
    await pod.copySettled()
  })
})

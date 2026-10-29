import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, toRunId, toThreadId } from '@dltech/atlas-core'
import { ECloudSandboxState, SessionsClient } from '@dltech/atlas-harness'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { dismissNotice } from '../../ui/notice-store'
import { clearAttachFailure } from '../attach-failure'
import { fakeBridge, type FakeBridge } from '../cloud/__tests__/fixture'
import { mountCloud } from './app-cloud-archive-fixture'
import { promiseGate } from './app-fixture'
import { FAKE_CONFIG, fakeApp, fakeCloud, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

afterEach(() => {
  dismissNotice()
  clearAttachFailure()
})

const TEXT = 'said before the pod parked'
const LOADING = 'Loading transcript'

const CLOUD_ID = toThreadId('cached-wake-thread')

const apiReadingOf = () =>
  fakeCloud({
    sessionsClientFor: ({ session }) =>
      new SessionsClient({
        url: session.url,
        token: session.token,
        fetchFn: (async () =>
          Response.json({
            result: {
              data: [
                {
                  id: 'event-cached-1',
                  seq: 1,
                  threadId: CLOUD_ID,
                  runId: 'run-before-park',
                  depth: 0,
                  at: '2026-10-02T00:00:00.000Z',
                  body: JSON.stringify({ type: 'user-said', text: TEXT }),
                },
              ],
            },
          })) as unknown as typeof fetch,
      }),
  })

const occurrences = (frame: string): number => frame.split(TEXT).length - 1

describe('opening a cloud thread whose pod must wake', () => {
  it('draws the API transcript under the boot block, then the pod replaces it without duplicates', async () => {
    const app: FakeApp = fakeApp({
      model: scriptedModelPort({ script: { thinking: 'a', reply: 'b' } }),
      cloud: apiReadingOf(),
    })
    const thread = await app.threads.create({
      id: CLOUD_ID,
      workspace: FAKE_CONFIG.cwd,
      repo: null,
    })
    await app.threads.chooseExecutionLocation({
      threadId: thread.id,
      location: EExecutionLocation.Cloud,
    })
    await app.threads.rename({
      threadId: thread.id,
      title: 'the cloud thread',
    })
    const bridge: FakeBridge = fakeBridge({
      status: {
        state: ECloudSandboxState.Running,
        url: 'https://sandbox.example/thread',
      },
    })
    const local = await app.threads.find({ threadId: thread.id })
    bridge.threads.seedThread({
      id: thread.id,
      head: 1,
      createdAt: local?.createdAt ?? '',
      updatedAt: local?.updatedAt ?? '',
      workspace: FAKE_CONFIG.cwd,
      repo: null,
      title: 'the cloud thread',
      executionLocation: EExecutionLocation.Cloud,
    })
    await bridge.log.append({
      threadId: thread.id,
      runId: toRunId('run-before-park'),
      drafts: [{ type: 'user-said', text: TEXT }],
    })
    const gate = promiseGate()
    const create = bridge.sandboxes.create
    bridge.sandboxes.create = async (given) => {
      await gate.gate
      return create(given)
    }
    const mounted = await mountCloud({
      app,
      bridge,
      opened: {
        threadId: thread.id,
        events: [],
        turns: [],
        name: null,
        started: false,
        bootCloudThreadId: thread.id,
      },
    })

    try {
      const held = await mounted.showing(TEXT)
      expect(held).toContain('WAKING THE POD')
      expect(held).not.toContain(LOADING)

      gate.release()
      await mounted.frame()
      const settled = await mounted.showing(TEXT)
      expect(occurrences(settled)).toBe(1)
      expect(settled).not.toContain('WAKING THE POD')
    } finally {
      gate.release()
      await mounted.done()
    }
  }, 60_000)
})

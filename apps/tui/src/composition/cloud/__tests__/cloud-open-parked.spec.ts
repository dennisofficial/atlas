import { describe, expect, it } from 'bun:test'

import { ERunner, toRunId, toThreadId } from '@dltech/atlas-core'
import { ECloudSandboxState } from '@dltech/atlas-harness'

import { SPEC_SHARD } from '../../__tests__/fake-backend'
import { fakeApp, scriptedModelPort } from '../../__tests__/fake-app'
import { cloudAttachmentOf } from '../../session-binding'
import { openCloudThread } from '../cloud-open'
import { fakeBridge } from './fixture'

const STOPPED = { state: ECloudSandboxState.Stopped, checkpoint: null }

const appWith = () =>
  fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }) })

describe('opening a local pod thread', () => {
  it('opens from the local copy without waking the pod', async () => {
    const app = appWith()
    const threadId = toThreadId(`local-pod-${SPEC_SHARD}-a`)
    await app.threads.create({ id: threadId, workspace: '/w', repo: null })
    await app.log.append({
      threadId,
      runId: toRunId('local-run'),
      drafts: [{ type: 'user-said', text: 'kept on disk' }],
    })
    const bridge = fakeBridge({ status: STOPPED })

    const binding = await openCloudThread({
      app,
      bridge,
      threadId,
      runner: ERunner.Local,
      onReload: async () => undefined,
    })
    cloudAttachmentOf(binding)?.settleOpen()
    await Bun.sleep(5)

    expect(bridge.created).toEqual([])
    expect(bridge.parkedAttaches).toEqual([threadId])
    expect(cloudAttachmentOf(binding)?.opened.events.length).toBeGreaterThan(0)
    binding.close?.()
  })

  it('wakes the pod when this machine holds no copy yet', async () => {
    const app = appWith()
    const threadId = toThreadId(`local-pod-${SPEC_SHARD}-b`)
    const bridge = fakeBridge({ status: STOPPED })

    const binding = await openCloudThread({
      app,
      bridge,
      threadId,
      runner: ERunner.Local,
      onReload: async () => undefined,
    })

    expect(bridge.created.map((call) => call.threadId)).toEqual([threadId])
    binding.close?.()
  })
})

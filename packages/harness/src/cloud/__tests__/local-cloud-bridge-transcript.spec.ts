import { describe, expect, it } from 'vitest'

import { toThreadId } from '@dltech/atlas-core'

import { WORKSPACE_SPEC_PATH, type BridgeDriver, type LiveSandbox } from '../local-cloud-bootstrap'
import { createLocalCloudBridge } from '../local-cloud-bridge'
import { ECloudSandboxState } from '../sandbox-client'
import type { SandboxPlacement, VercelSandboxConfig } from '@dltech/atlas-wire'

const threadId = toThreadId('thread-transcript')

type RecordedWrite = { path: string; content: Uint8Array | string }

const config: VercelSandboxConfig = {
  credentials: { token: 'vt', teamId: 'team', projectId: 'proj' },
  image: 'atlas-sandbox:test',
}

const fakeDriver = (args: { observed: boolean }) => {
  const writes: RecordedWrite[] = []
  const liveSandbox = {}
  const driver: BridgeDriver = {
    inspect: async () =>
      args.observed
        ? { state: ECloudSandboxState.Parked, url: 'https://old.vercel.run' }
        : undefined,
    createOrResume: async (createArgs) => {
      if (createArgs.putContextOnFreshBoot !== undefined) {
        await createArgs.putContextOnFreshBoot(liveSandbox as unknown as LiveSandbox)
      }
      const placement: SandboxPlacement = {
        sessionId: 'session-1',
        url: 'https://sb.vercel.run',
        state: ECloudSandboxState.Running,
        created: !args.observed,
        token: 'tok',
      }
      return placement
    },
    writeBootstrapFileToSandbox: async (write) => {
      writes.push({ path: write.path, content: write.content })
    },
    writeBootstrapFile: async () => {},
    readResources: async () => ({}),
    updateResources: async () => {},
    destroy: async () => {},
  }
  return { driver, writes }
}

const bridgeWith = (driver: BridgeDriver) =>
  createLocalCloudBridge({
    vercel: () => config,
    attachmentToken: () => 'tok',
    driverWith: () => driver,
  })

describe('createLocalCloudBridge bootstrap writes', () => {
  it('writes the workspace spec on a fresh boot', async () => {
    const { driver, writes } = fakeDriver({ observed: false })

    await bridgeWith(driver).sandboxes.create({
      threadId,
      projectId: 'proj_1',
    })

    const spec = writes.find((entry) => entry.path === WORKSPACE_SPEC_PATH)
    expect(JSON.parse(String(spec?.content))).toMatchObject({ projectId: 'proj_1' })
  })

  it('writes no bootstrap spec on a healthy resume', async () => {
    const { driver, writes } = fakeDriver({ observed: true })

    const placement = await bridgeWith(driver).sandboxes.create({ threadId, projectId: null })

    expect(placement.created).toBe(false)
    expect(writes.some((entry) => entry.path === WORKSPACE_SPEC_PATH)).toBe(false)
  })

  it('writes no bootstrap files at all on a healthy resume', async () => {
    const { driver, writes } = fakeDriver({ observed: true })

    await bridgeWith(driver).sandboxes.create({ threadId, projectId: null })

    expect(writes).toHaveLength(0)
  })
})

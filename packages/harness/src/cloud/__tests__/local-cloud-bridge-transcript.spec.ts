import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import {
  CONTEXT_ARCHIVE_PATH,
  WORKSPACE_SPEC_PATH,
  type BridgeDriver,
  type LiveSandbox,
} from '../local-cloud-bootstrap'
import { createLocalCloudBridge } from '../local-cloud-bridge'
import { ECloudSandboxState } from '../sandbox-client'
import type { SandboxPlacement, VercelSandboxConfig } from '@dltech/atlas-wire'
import type { SandboxTransferProgress } from '../transfer-progress'

const threadId = toThreadId('thread-transcript')

type RecordedWrite = { path: string; content: Uint8Array | string }

const config: VercelSandboxConfig = {
  credentials: { token: 'vt', teamId: 'team', projectId: 'proj' },
  image: 'atlas-sandbox:test',
}

const fakeDriver = (args: { observed: boolean; vaultPresent?: boolean }) => {
  const events: string[] = []
  const writes: RecordedWrite[] = []
  const liveSandbox = {
    runCommand: async () => {
      events.push('vault-probe')
      return { exitCode: args.vaultPresent === false ? 1 : 0 }
    },
  }
  const driver: BridgeDriver = {
    inspect: async () =>
      args.observed ? { state: ECloudSandboxState.Parked, url: 'https://old.vercel.run' } : undefined,
    createOrResume: async (createArgs) => {
      events.push('create')
      if (createArgs.putContextOnFreshBoot !== undefined) {
        await createArgs.putContextOnFreshBoot(liveSandbox as unknown as LiveSandbox)
      }
      events.push('launch')
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
      events.push(`write:${write.path}`)
      writes.push({ path: write.path, content: write.content })
    },
    writeBootstrapFile: async () => {},
    readResources: async () => ({}),
    updateResources: async () => {},
    destroy: async () => {},
  }
  return { driver, events, writes }
}

const bridgeWith = (driver: BridgeDriver) =>
  createLocalCloudBridge({
    vercel: () => config,
    attachmentToken: () => 'tok',
    driverWith: () => driver,
  })

describe('createLocalCloudBridge bootstrap writes', () => {
  it('writes the workspace spec on a fresh boot and never uploads an archive', async () => {
    const { driver, events, writes } = fakeDriver({ observed: false })

    await bridgeWith(driver).sandboxes.create({
      threadId,
      workspace: { remoteUrl: 'git@github.com:comp-ai/atlas.git' },
    })

    expect(events.some((event) => event.startsWith('upload:'))).toBe(false)
    const spec = writes.find((entry) => entry.path === WORKSPACE_SPEC_PATH)
    expect(String(spec?.content)).toContain('git@github.com:comp-ai/atlas.git')
  })

  it('writes no bootstrap spec on a healthy resume', async () => {
    const { driver, events, writes } = fakeDriver({ observed: true, vaultPresent: true })

    const placement = await bridgeWith(driver).sandboxes.create({ threadId, workspace: null })

    expect(placement.created).toBe(false)
    expect(writes.some((entry) => entry.path === WORKSPACE_SPEC_PATH)).toBe(false)
    expect(events.some((event) => event.startsWith('upload:'))).toBe(false)
  })

  it('writes no bootstrap files at all on a healthy resume without context', async () => {
    const { driver, writes } = fakeDriver({ observed: true, vaultPresent: true })

    await bridgeWith(driver).sandboxes.create({ threadId, workspace: null })

    expect(writes).toHaveLength(0)
  })

  it('uploads the context archive before launch when the birth captures one', async () => {
    const { driver, events } = fakeDriver({ observed: false })
    const progress: SandboxTransferProgress[] = []
    await bridgeWith(driver).sandboxes.create({
      threadId,
      workspace: null,
      captureContext: async (put) => put(new Uint8Array(6)),
      onTransferProgress: (reading) => {
        expect(events).not.toContain('launch')
        progress.push(reading)
      },
    })

    expect(progress).toEqual([
      { transferId: 'context-upload', label: 'uploading skills and memory', transferredBytes: 0, totalBytes: 6, complete: false },
      { transferId: 'context-upload', label: 'uploading skills and memory', transferredBytes: 6, totalBytes: 6, complete: true },
    ])
  })

  it('does not report a buffered context upload complete when its write fails', async () => {
    const { driver } = fakeDriver({ observed: false })
    const progress: SandboxTransferProgress[] = []
    driver.writeBootstrapFileToSandbox = async ({ path }) => {
      if (path.endsWith('context.tar.gz')) throw new Error('upload rejected')
    }
    await expect(bridgeWith(driver).sandboxes.create({
      threadId,
      workspace: null,
      captureContext: async (put) => put(new Uint8Array(4)),
      onTransferProgress: (reading) => progress.push(reading),
    })).rejects.toThrow('upload rejected')
    expect(progress).toHaveLength(1)
    expect(progress[0]?.complete).toBe(false)
    expect(progress[0]?.transferredBytes).toBe(0)
  })

  it('captures no context on a healthy resume, since the sandbox already installed it', async () => {
    const { driver, writes } = fakeDriver({ observed: true, vaultPresent: true })
    let captured = 0

    await bridgeWith(driver).sandboxes.create({
      threadId,
      workspace: null,
      captureContext: async (put) => {
        captured += 1
        await put(new Uint8Array(2))
      },
    })

    expect(captured).toBe(0)
    expect(writes.some((entry) => entry.path === CONTEXT_ARCHIVE_PATH)).toBe(false)
  })

  it('recaptures the context when a resumed sandbox lost its installed state', async () => {
    const { driver, writes } = fakeDriver({ observed: true, vaultPresent: false })

    await bridgeWith(driver).sandboxes.create({
      threadId,
      workspace: null,
      captureContext: async (put) => put(new Uint8Array(2)),
    })

    expect(writes.some((entry) => entry.path === CONTEXT_ARCHIVE_PATH)).toBe(true)
  })

  it('keeps the context archive write ahead of the serve launch', async () => {
    const { driver, events, writes } = fakeDriver({ observed: false })

    await bridgeWith(driver).sandboxes.create({
      threadId,
      workspace: null,
      captureContext: async (put) => put(new Uint8Array(2)),
    })

    expect(writes.some((entry) => entry.path === CONTEXT_ARCHIVE_PATH)).toBe(true)
    expect(events.indexOf(`write:${CONTEXT_ARCHIVE_PATH}`)).toBeLessThan(events.indexOf('launch'))
  })
})

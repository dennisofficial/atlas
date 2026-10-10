import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import {
  TRANSCRIPT_ARCHIVE_PATH,
  WORKSPACE_ARCHIVE_PATH,
  WORKSPACE_SPEC_PATH,
  type BridgeDriver,
  type LiveSandbox,
} from '../local-cloud-bootstrap'
import { createLocalCloudBridge } from '../local-cloud-bridge'
import { sandboxNameFor } from '../sandbox-names'
import { ECloudSandboxState } from '../sandbox-client'
import type { SandboxPlacement, VercelSandboxConfig } from '@dltech/atlas-wire'
import type { SandboxTransferProgress, TransferProgress } from '../transfer-progress'

const threadId = toThreadId('thread-transcript')
const TRANSCRIPT_PATH = '/tmp/local/transcript.tar.gz'

type RecordedWrite = { path: string; content: Uint8Array | string }

const config: VercelSandboxConfig = {
  credentials: { token: 'vt', teamId: 'team', projectId: 'proj' },
  image: 'atlas-sandbox:test',
}

const fakeDriver = (args: { observed: boolean; vaultPresent?: boolean }) => {
  const events: string[] = []
  const writes: RecordedWrite[] = []
  const liveSandbox = {
    runCommand: async (params: { args?: string[] }) => {
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
        driveName: 'drive-1',
        token: 'tok',
      }
      return placement
    },
    writeBootstrapFileToSandbox: async (write) => {
      events.push(`write:${write.path}`)
      writes.push({ path: write.path, content: write.content })
    },
    writeBootstrapFile: async () => {},
    uploadWorkspaceArchive: async (upload) => {
      events.push(`upload:${upload.destination}:${upload.source}`)
      upload.onProgress?.({ transferredBytes: 0, totalBytes: 10, complete: false })
      upload.onProgress?.({ transferredBytes: 4, totalBytes: 10, complete: false })
      upload.onProgress?.({ transferredBytes: 10, totalBytes: 10, complete: true })
    },
    downloadWorkspaceArchive: async () => {},
    releaseWorkspaceArchive: async () => {},
    downloadSessionArchive: async (download) => {
      events.push(`download-session:${download.name}:${download.archive.path}:${download.destination}`)
      download.onProgress?.({ transferredBytes: 1, totalBytes: download.archive.size, complete: false })
    },
    releaseSessionArchive: async (release) => {
      events.push(`release-session:${release.name}:${release.path}`)
    },
    transcriptLanded: async () => true,
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

describe('createLocalCloudBridge transcript handoff', () => {
  it('uploads the transcript archive file into the bootstrap before serve launches on a fresh boot', async () => {
    const { driver, events, writes } = fakeDriver({ observed: false })

    await bridgeWith(driver).sandboxes.create({
      threadId,
      workspace: null,
      transcriptArchivePath: TRANSCRIPT_PATH,
    })

    const upload = events.indexOf(`upload:${TRANSCRIPT_ARCHIVE_PATH}:${TRANSCRIPT_PATH}`)
    expect(upload).toBeGreaterThan(-1)
    expect(events.indexOf('launch')).toBeGreaterThan(upload)
    expect(writes.some((entry) => entry.path === TRANSCRIPT_ARCHIVE_PATH)).toBe(false)
  })

  it('uploads an explicit transcript on a resumed boot too, independent of the fresh-boot spec write', async () => {
    const { driver, events, writes } = fakeDriver({ observed: true, vaultPresent: true })

    const placement = await bridgeWith(driver).sandboxes.create({
      threadId,
      workspace: null,
      transcriptArchivePath: TRANSCRIPT_PATH,
    })

    expect(placement.created).toBe(false)
    expect(writes.some((entry) => entry.path === WORKSPACE_SPEC_PATH)).toBe(false)
    expect(events.indexOf(`upload:${TRANSCRIPT_ARCHIVE_PATH}:${TRANSCRIPT_PATH}`)).toBeGreaterThan(-1)
    expect(events.indexOf(`upload:${TRANSCRIPT_ARCHIVE_PATH}:${TRANSCRIPT_PATH}`)).toBeLessThan(
      events.indexOf('launch'),
    )
  })

  it('never rewrites the transcript when a reconnect or wake supplies none', async () => {
    const { driver, events, writes } = fakeDriver({ observed: true, vaultPresent: true })

    await bridgeWith(driver).sandboxes.create({ threadId, workspace: null })

    expect(writes.some((entry) => entry.path === TRANSCRIPT_ARCHIVE_PATH)).toBe(false)
    expect(events.some((event) => event.startsWith(`upload:${TRANSCRIPT_ARCHIVE_PATH}`))).toBe(false)
  })

  it('writes no bootstrap files at all on a healthy resume without a transcript', async () => {
    const { driver, writes } = fakeDriver({ observed: true, vaultPresent: true })

    await bridgeWith(driver).sandboxes.create({ threadId, workspace: null })

    expect(writes).toHaveLength(0)
  })

  it('uploads an explicit workspace archive before launch on a fresh boot, keeping its path out of the spec', async () => {
    const { driver, events, writes } = fakeDriver({ observed: false })

    await bridgeWith(driver).sandboxes.create({
      threadId,
      workspace: null,
      workspaceArchivePath: '/tmp/local/workspace.tar.gz',
    })

    const upload = events.indexOf(`upload:${WORKSPACE_ARCHIVE_PATH}:/tmp/local/workspace.tar.gz`)
    expect(upload).toBeGreaterThan(-1)
    expect(events.indexOf('launch')).toBeGreaterThan(upload)
    const spec = writes.find((entry) => entry.path === WORKSPACE_SPEC_PATH)
    expect(String(spec?.content)).not.toContain('/tmp/local')
  })

  it('uploads an explicit workspace archive on a resumed boot too', async () => {
    const { driver, events, writes } = fakeDriver({ observed: true, vaultPresent: true })

    await bridgeWith(driver).sandboxes.create({
      threadId,
      workspace: null,
      workspaceArchivePath: '/tmp/local/workspace.tar.gz',
    })

    expect(writes.some((entry) => entry.path === WORKSPACE_SPEC_PATH)).toBe(false)
    expect(events.indexOf(`upload:${WORKSPACE_ARCHIVE_PATH}:/tmp/local/workspace.tar.gz`)).toBeLessThan(
      events.indexOf('launch'),
    )
  })

  it('reports each upload independently before the sandbox launches', async () => {
    const { driver, events } = fakeDriver({ observed: false })
    const progress: SandboxTransferProgress[] = []
    await bridgeWith(driver).sandboxes.create({
      threadId,
      workspace: null,
      transcriptArchivePath: TRANSCRIPT_PATH,
      workspaceArchivePath: '/tmp/local/workspace.tar.gz',
      captureContext: async (put) => put(new Uint8Array(6)),
      onTransferProgress: (reading) => {
        expect(events).not.toContain('launch')
        progress.push(reading)
      },
    })

    expect(progress.filter((reading) => reading.transferId === 'transcript-upload')).toEqual([
      { transferId: 'transcript-upload', label: 'uploading conversation', transferredBytes: 0, totalBytes: 10, complete: false },
      { transferId: 'transcript-upload', label: 'uploading conversation', transferredBytes: 4, totalBytes: 10, complete: false },
      { transferId: 'transcript-upload', label: 'uploading conversation', transferredBytes: 10, totalBytes: 10, complete: true },
    ])
    expect(progress.filter((reading) => reading.transferId === 'workspace-upload').map((reading) => reading.transferredBytes)).toEqual([0, 4, 10])
    expect(progress.filter((reading) => reading.transferId === 'context-upload')).toEqual([
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

  it('forwards a download total and byte readings through the driver', async () => {
    const { driver } = fakeDriver({ observed: true })
    const progress: TransferProgress[] = []
    driver.downloadWorkspaceArchive = async (args) => {
      expect(args.name).toBe(sandboxNameFor({ threadId }))
      expect(args.totalBytes).toBe(20)
      args.onProgress?.({ transferredBytes: 5, totalBytes: args.totalBytes, complete: false })
    }
    await bridgeWith(driver).sandboxes.downloadWorkspace?.({
      threadId,
      path: '/atlas/home/exports/workspace-test.tar.gz',
      destination: '/tmp/workspace.tar.gz',
      totalBytes: 20,
      onProgress: (reading) => progress.push(reading),
    })
    expect(progress).toEqual([{ transferredBytes: 5, totalBytes: 20, complete: false }])
  })

  it('uploads no workspace archive when none is supplied', async () => {
    const { driver, events } = fakeDriver({ observed: true, vaultPresent: true })

    await bridgeWith(driver).sandboxes.create({ threadId, workspace: null })

    expect(events.some((event) => event.startsWith('upload:'))).toBe(false)
  })

  it('binds session download and release to the thread sandbox name', async () => {
    const { driver, events } = fakeDriver({ observed: true })
    const sandboxes = bridgeWith(driver).sandboxes
    const archive = { path: '/atlas/home/exports/session-x.tar.gz', size: 3, sha256: 'ab', threadId }

    const progress: TransferProgress[] = []
    await sandboxes.downloadSession?.({ threadId, archive, destination: '/tmp/dest.partial', onProgress: (reading) => progress.push(reading) })
    expect(progress).toEqual([{ transferredBytes: 1, totalBytes: 3, complete: false }])
    await sandboxes.releaseSession?.({ threadId, path: archive.path })

    const name = sandboxNameFor({ threadId })
    expect(events).toEqual([
      `download-session:${name}:${archive.path}:/tmp/dest.partial`,
      `release-session:${name}:${archive.path}`,
    ])
  })
})

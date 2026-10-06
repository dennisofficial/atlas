import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'
import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import { type BridgeDriver } from '../local-cloud-bootstrap'
import { createLocalCloudBridge } from '../local-cloud-bridge'
import { ECloudSandboxState } from '../sandbox-client'

const threadId = toThreadId('thread-status')
const checkpoint: RuntimeCheckpoint = {
  threadId,
  runtimeId: 'runtime-1',
  sandboxSessionId: 'session-1',
  revision: 1,
  phase: ERuntimePhase.Parked,
  reportedAt: '2026-10-01T18:00:00.000Z',
  transcript: { head: 0, count: 0, digest: '0'.repeat(64) },
}

const fixture = (args: {
  observed?: Awaited<ReturnType<BridgeDriver['inspect']>>
  readCheckpoint?: () => Promise<RuntimeCheckpoint | null>
}) => {
  let creates = 0
  let destroys = 0
  const driver: BridgeDriver = {
    inspect: async () => args.observed,
    createOrResume: async () => {
      creates += 1
      throw new Error('status inspection must never provision')
    },
    writeBootstrapFileToSandbox: async () => undefined,
    writeBootstrapFile: async () => undefined,
    uploadWorkspaceArchive: async () => undefined,
    downloadWorkspaceArchive: async () => undefined,
    releaseWorkspaceArchive: async () => undefined,
    downloadSessionArchive: async () => undefined,
    releaseSessionArchive: async () => undefined,
    transcriptLanded: async () => false,
    destroy: async () => { destroys += 1 },
  }
  const bridge = createLocalCloudBridge({
    vercel: () => ({
      credentials: { token: 'test', teamId: 'team', projectId: 'project' },
      image: 'test',
    }),
    attachmentToken: () => 'test',
    driverWith: () => driver,
    ...(args.readCheckpoint === undefined ? {} : { readCheckpoint: args.readCheckpoint }),
  })
  return { bridge, creates: () => creates, destroys: () => destroys }
}

describe('non-waking cloud sandbox inspection', () => {
  it('keeps provider lifecycle separate from a finalized metadata report', async () => {
    const setup = fixture({
      observed: { state: ECloudSandboxState.Running, sandboxSessionId: 'session-2' },
      readCheckpoint: async () => checkpoint,
    })
    expect(await setup.bridge.sandboxes.find({ threadId })).toEqual({
      state: ECloudSandboxState.Running,
      sandboxSessionId: 'session-2',
      checkpoint,
    })
    expect(setup.creates()).toBe(0)
    expect(setup.destroys()).toBe(0)
  })

  it('retains provider evidence when the optional API is unavailable', async () => {
    const setup = fixture({
      observed: { state: ECloudSandboxState.Parked, sandboxSessionId: 'session-1' },
      readCheckpoint: async () => { throw new Error('API unavailable') },
    })
    expect(await setup.bridge.sandboxes.find({ threadId })).toEqual({
      state: ECloudSandboxState.Parked,
      sandboxSessionId: 'session-1',
      checkpoint: null,
    })
    expect(setup.creates()).toBe(0)
  })

  it('does not call a missing sandbox parked', async () => {
    const setup = fixture({ readCheckpoint: async () => checkpoint })
    expect(await setup.bridge.sandboxes.find({ threadId })).toEqual({
      state: ECloudSandboxState.Stopped,
      checkpoint,
    })
    expect(setup.creates()).toBe(0)
  })

  it('discards a report naming a different thread without changing provider state', async () => {
    const setup = fixture({
      observed: { state: ECloudSandboxState.Parked, sandboxSessionId: 'session-1' },
      readCheckpoint: async () => ({ ...checkpoint, threadId: 'other-thread' }),
    })
    expect(await setup.bridge.sandboxes.find({ threadId })).toEqual({
      state: ECloudSandboxState.Parked,
      sandboxSessionId: 'session-1',
      checkpoint: null,
    })
    expect(setup.creates()).toBe(0)
  })

  it('inspects without requiring a cloud account', async () => {
    const setup = fixture({ observed: { state: ECloudSandboxState.Running } })
    expect(await setup.bridge.sandboxes.find({ threadId })).toEqual({
      state: ECloudSandboxState.Running,
      checkpoint: null,
    })
  })
})

import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { EServeEnv } from '@dltech/atlas-wire'

import type { BridgeDriver } from '../local-cloud-bootstrap'
import { createLocalCloudBridge } from '../local-cloud-bridge'
import { ECloudSandboxState } from '../sandbox-client'
import type { VercelSandboxConfig } from '@dltech/atlas-wire'

const threadId = toThreadId('thread-workspace')

const config: VercelSandboxConfig = {
  credentials: { token: 'vt', teamId: 'team', projectId: 'proj' },
  image: 'atlas-sandbox:test',
}

const bridgeSeeing = (args: { environment?: Record<string, string> }) => {
  const seen: (Record<string, string> | undefined)[] = []
  const driver: BridgeDriver = {
    inspect: async () => undefined,
    createOrResume: async (createArgs) => {
      seen.push(createArgs.environment)
      return {
        sessionId: 'session-1',
        url: 'https://sb.vercel.run',
        state: ECloudSandboxState.Running,
        created: true,
        driveName: 'drive-1',
        token: 'tok',
      }
    },
    writeBootstrapFileToSandbox: async () => {},
    writeBootstrapFile: async () => {},
    uploadWorkspaceArchive: async () => {},
    downloadWorkspaceArchive: async () => {},
    releaseWorkspaceArchive: async () => {},
    downloadSessionArchive: async () => {},
    releaseSessionArchive: async () => {},
    transcriptLanded: async () => true,
    destroy: async () => {},
  }
  const bridge = createLocalCloudBridge({
    vercel: () => config,
    attachmentToken: () => 'tok',
    driverWith: () => driver,
    ...(args.environment === undefined ? {} : { environment: () => args.environment ?? {} }),
  })
  return { bridge, seen }
}

describe('createLocalCloudBridge workspace directory', () => {
  it('hands the named primary path to the sandbox as its workspace directory', async () => {
    const { bridge, seen } = bridgeSeeing({})

    await bridge.sandboxes.create({ threadId, workspace: null, workspaceDirectory: '/atlas/workspaces/atlas' })

    expect(seen).toEqual([{ [EServeEnv.WorkspaceDir]: '/atlas/workspaces/atlas' }])
  })

  it('lets the supplied primary path win over the operator environment while keeping the rest', async () => {
    const { bridge, seen } = bridgeSeeing({
      environment: { [EServeEnv.WorkspaceDir]: '/elsewhere', ATLAS_CLASSIFIER_MODE: 'nudge' },
    })

    await bridge.sandboxes.create({ threadId, workspace: null, workspaceDirectory: '/atlas/workspaces/atlas' })

    expect(seen).toEqual([
      { [EServeEnv.WorkspaceDir]: '/atlas/workspaces/atlas', ATLAS_CLASSIFIER_MODE: 'nudge' },
    ])
  })

  it('adds no workspace directory when none is supplied, as a reconnect does', async () => {
    const { bridge, seen } = bridgeSeeing({ environment: { ATLAS_CLASSIFIER_MODE: 'nudge' } })

    await bridge.sandboxes.create({ threadId, workspace: null })

    expect(seen).toEqual([{ ATLAS_CLASSIFIER_MODE: 'nudge' }])
  })

  it('passes no environment at all when there is nothing to say', async () => {
    const { bridge, seen } = bridgeSeeing({})

    await bridge.sandboxes.create({ threadId, workspace: null })

    expect(seen).toEqual([undefined])
  })
})

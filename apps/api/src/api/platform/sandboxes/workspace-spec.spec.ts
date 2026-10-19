import { describe, expect, it } from 'vitest'
import type { CloudSandboxModel } from '../../../db'
import type { SandboxWorkspaceSpec } from './sandboxes.types'
import { workspaceColumnsOf, workspaceSpecOf } from './workspace-spec'

describe('workspace spec columns', () => {
  it('round-trips remoteUrl through the stored columns', () => {
    const spec: SandboxWorkspaceSpec = {
      remoteUrl: 'https://github.com/dennisofficial/atlas.git',
    }

    const columns = workspaceColumnsOf(spec)
    expect(columns.workspaceRemoteUrl).toBe(spec.remoteUrl)

    const row = {
      workspaceRemoteUrl: columns.workspaceRemoteUrl,
    } as unknown as CloudSandboxModel

    expect(workspaceSpecOf(row).remoteUrl).toBe(spec.remoteUrl)
  })

  it('defaults remoteUrl to null when the spec omits it', () => {
    expect(workspaceColumnsOf(undefined).workspaceRemoteUrl).toBeNull()

    const row = { workspaceRemoteUrl: null } as unknown as CloudSandboxModel
    expect(workspaceSpecOf(row).remoteUrl).toBeNull()
  })
})

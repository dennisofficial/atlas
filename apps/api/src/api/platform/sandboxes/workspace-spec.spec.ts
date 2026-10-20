import { describe, expect, it } from 'vitest'
import type { SandboxWorkspaceSpec } from './sandboxes.types'
import { workspaceColumnsOf } from './workspace-spec'

describe('workspace spec columns', () => {
  it('stores remoteUrl in the workspace column', () => {
    const spec: SandboxWorkspaceSpec = {
      remoteUrl: 'https://github.com/dennisofficial/atlas.git',
    }

    const columns = workspaceColumnsOf(spec)
    expect(columns.workspaceRemoteUrl).toBe(spec.remoteUrl)
  })

  it('defaults remoteUrl to null when the spec omits it', () => {
    expect(workspaceColumnsOf(undefined).workspaceRemoteUrl).toBeNull()
  })
})

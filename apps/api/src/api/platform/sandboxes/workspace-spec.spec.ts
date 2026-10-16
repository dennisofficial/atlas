import { describe, expect, it } from 'vitest'
import type { CloudSandboxModel } from '../../../db'
import type { SandboxWorkspaceSpec } from './sandboxes.types'
import { MAX_CONTEXT_BUNDLE_BYTES, WORKSPACE_BODY_LIMIT, workspaceColumnsOf, workspaceSpecOf } from './workspace-spec'

const bodyLimitBytes = (limit: string): number => {
  const megabytes = limit.match(/^(\d+)mb$/)
  if (megabytes?.[1] === undefined) throw new Error(`unrecognized body limit: ${limit}`)
  return Number(megabytes[1]) * 1024 * 1024
}

describe('WORKSPACE_BODY_LIMIT', () => {
  it('clears MAX_CONTEXT_BUNDLE_BYTES so a full bundle never hits the raw body-parser 413', () => {
    expect(bodyLimitBytes(WORKSPACE_BODY_LIMIT)).toBeGreaterThan(MAX_CONTEXT_BUNDLE_BYTES)
  })
})

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
    expect(workspaceColumnsOf(undefined).workspaceContext).toBeNull()

    const row = { workspaceRemoteUrl: null } as unknown as CloudSandboxModel
    expect(workspaceSpecOf(row).remoteUrl).toBeNull()
  })
})

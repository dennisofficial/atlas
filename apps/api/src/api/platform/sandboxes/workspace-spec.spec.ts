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
  it('round-trips projectDirectory through the stored columns', () => {
    const spec: SandboxWorkspaceSpec = {
      remoteUrl: 'https://github.com/dennisofficial/atlas.git',
      branch: 'dennis/serve-parity',
      commit: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c',
      patch: '',
      projectDirectory: '/Users/dennis/repos/atlas',
    }

    const columns = workspaceColumnsOf(spec)
    expect(columns.workspaceProjectDirectory).toBe(spec.projectDirectory)

    const row = {
      workspaceRemoteUrl: columns.workspaceRemoteUrl,
      workspaceBranch: columns.workspaceBranch,
      workspaceCommit: columns.workspaceCommit,
      workspacePatch: columns.workspacePatch,
      workspaceProjectDirectory: columns.workspaceProjectDirectory,
    } as unknown as CloudSandboxModel

    expect(workspaceSpecOf(row).projectDirectory).toBe(spec.projectDirectory)
  })

  it('defaults projectDirectory to null when the spec omits it', () => {
    const spec: SandboxWorkspaceSpec = {
      remoteUrl: null,
      branch: null,
      commit: null,
      patch: '',
    }

    expect(workspaceColumnsOf(spec).workspaceProjectDirectory).toBeNull()
    expect(workspaceColumnsOf(undefined).workspaceProjectDirectory).toBeNull()
  })

  it('round-trips gitIdentity through the stored columns', () => {
    const spec: SandboxWorkspaceSpec = {
      remoteUrl: 'https://github.com/dennisofficial/atlas.git',
      branch: 'dennis/serve-parity',
      commit: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c',
      patch: '',
      gitIdentity: { name: 'Dennis Lysenko', email: 'dennis@comp.ai' },
    }

    const columns = workspaceColumnsOf(spec)
    expect(columns.workspaceGitName).toBe('Dennis Lysenko')
    expect(columns.workspaceGitEmail).toBe('dennis@comp.ai')

    const row = {
      workspaceRemoteUrl: columns.workspaceRemoteUrl,
      workspaceBranch: columns.workspaceBranch,
      workspaceCommit: columns.workspaceCommit,
      workspacePatch: columns.workspacePatch,
      workspaceProjectDirectory: columns.workspaceProjectDirectory,
      workspaceGitName: columns.workspaceGitName,
      workspaceGitEmail: columns.workspaceGitEmail,
    } as unknown as CloudSandboxModel

    expect(workspaceSpecOf(row).gitIdentity).toEqual(spec.gitIdentity)
  })

  it('serves gitIdentity as null when the spec omits it', () => {
    const spec: SandboxWorkspaceSpec = {
      remoteUrl: null,
      branch: null,
      commit: null,
      patch: '',
    }

    const columns = workspaceColumnsOf(spec)
    expect(columns.workspaceGitName).toBeNull()
    expect(columns.workspaceGitEmail).toBeNull()
    expect(workspaceColumnsOf(undefined).workspaceGitName).toBeNull()
    expect(workspaceColumnsOf(undefined).workspaceGitEmail).toBeNull()

    const row = {
      workspaceRemoteUrl: null,
      workspaceBranch: null,
      workspaceCommit: null,
      workspacePatch: null,
      workspaceProjectDirectory: null,
      workspaceGitName: null,
      workspaceGitEmail: null,
    } as unknown as CloudSandboxModel

    expect(workspaceSpecOf(row).gitIdentity).toBeNull()
  })

  it('serves gitIdentity as null when a row holds only one of name and email', () => {
    const partial = {
      workspaceRemoteUrl: null,
      workspaceBranch: null,
      workspaceCommit: null,
      workspacePatch: null,
      workspaceProjectDirectory: null,
    }

    const nameOnly = {
      ...partial,
      workspaceGitName: 'Dennis Lysenko',
      workspaceGitEmail: null,
    } as unknown as CloudSandboxModel
    const emailOnly = {
      ...partial,
      workspaceGitName: null,
      workspaceGitEmail: 'dennis@comp.ai',
    } as unknown as CloudSandboxModel

    expect(workspaceSpecOf(nameOnly).gitIdentity).toBeNull()
    expect(workspaceSpecOf(emailOnly).gitIdentity).toBeNull()
  })
})

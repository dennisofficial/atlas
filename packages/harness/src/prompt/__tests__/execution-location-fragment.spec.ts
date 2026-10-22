import { describe, expect, it } from 'bun:test'
import {
  EExecutionLocation,
  promptContextFor,
  EPromptAgent,
  type ProviderIdentity,
  type PromptModel,
} from '@dltech/atlas-core'

import { ExecutionLocationFragment } from '../fragments/environment'

const ctx = (placement?: EExecutionLocation) =>
  promptContextFor({
    agent: EPromptAgent.Main,
    provider: { id: 'test', modelId: 'test-model' } as unknown as ProviderIdentity,
    model: { contextWindow: 100000 } as unknown as PromptModel,
    projectDirectory: '/repo',
    placement,
  })

describe('execution-location fragment', () => {
  it('states the session placement declaratively so the model never guesses from a path', () => {
    expect(new ExecutionLocationFragment().text(ctx(EExecutionLocation.Cloud))).toContain(
      'This session is running in the cloud',
    )
    expect(new ExecutionLocationFragment().text(ctx(EExecutionLocation.Docker))).toContain(
      'in a Docker container',
    )
    expect(new ExecutionLocationFragment().text(ctx(EExecutionLocation.Host))).toContain(
      "running locally on the operator's machine (the host)",
    )
  })

  it('defaults to host when placement is absent', () => {
    expect(new ExecutionLocationFragment().text(ctx(undefined))).toContain(
      "running locally on the operator's machine (the host)",
    )
  })

  it('explains sibling cloning and ephemeral cloud workspaces', () => {
    const text = new ExecutionLocationFragment().text(ctx())
    expect(text).toContain('/atlas/workspaces/<repo-name>')
    expect(text).toContain('Repositories the project configures are already cloned beside it')
    expect(text).toContain('Adjacent clones are ephemeral')
    expect(text).toContain('sandbox cleanup deletes them')
  })

  it('tells the model gitignored content does not reach a cloud sandbox and to install on demand', () => {
    const text = new ExecutionLocationFragment().text(ctx())
    expect(text).toContain('Gitignored content')
    expect(text).toContain('does not reach a cloud sandbox')
    expect(text).toContain("project's own install")
  })

  it('no longer describes the retired lift/descend machinery', () => {
    const text = new ExecutionLocationFragment().text(ctx())
    expect(text).not.toContain('Lift and descend')
    expect(text).not.toContain('descend leaves them behind')
  })
})

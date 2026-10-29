import { describe, expect, it } from 'bun:test'
import {
  EExecutionLocation,
  ERunner,
  promptContextFor,
  EPromptAgent,
  type ProviderIdentity,
  type PromptModel,
} from '@dltech/atlas-core'

import { ExecutionLocationFragment } from '../fragments/environment'

const ctx = (placement?: EExecutionLocation, runner?: ERunner) =>
  promptContextFor({
    agent: EPromptAgent.Main,
    provider: {
      id: 'test',
      modelId: 'test-model',
    } as unknown as ProviderIdentity,
    model: { contextWindow: 100000 } as unknown as PromptModel,
    projectDirectory: '/repo',
    placement,
    runner,
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

  it('describes a local pod, not a Vercel sandbox, when the runner is local', () => {
    const text = new ExecutionLocationFragment().text(ctx(EExecutionLocation.Cloud, ERunner.Local))
    expect(text).toContain('local Docker pod on the operator')
    expect(text).not.toContain('Vercel')
    expect(text).not.toContain('cannot publish pod ports')
    expect(text).not.toContain('curl')
    expect(text).toContain('exposePort')
    expect(text).toContain('0.0.0.0')
    expect(text).toContain('.sandbox.localhost')
  })

  it('keeps the Vercel line for a vercel or unknown runner', () => {
    for (const runner of [ERunner.Vercel, undefined]) {
      expect(new ExecutionLocationFragment().text(ctx(EExecutionLocation.Cloud, runner))).toContain(
        'a Vercel sandbox',
      )
    }
  })

  it('stamps the runner so a pod and a sandbox never share a cache entry', () => {
    const fragment = new ExecutionLocationFragment()
    expect(fragment.stamp(ctx(EExecutionLocation.Cloud, ERunner.Local))).not.toBe(
      fragment.stamp(ctx(EExecutionLocation.Cloud, ERunner.Vercel)),
    )
  })
})

import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_CONTAINER_IDLE_MINUTES,
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

const textFor = (placement?: EExecutionLocation, runner?: ERunner) =>
  new ExecutionLocationFragment().text(ctx(placement, runner))

const POD_RUNNERS = [ERunner.Local, ERunner.Vercel, undefined]

describe('execution-location fragment', () => {
  it('states the session placement declaratively so the model never guesses from a path', () => {
    expect(textFor(EExecutionLocation.Cloud)).toContain('This session runs in a throwaway pod')
    expect(textFor(EExecutionLocation.Docker)).toContain('in a Docker container')
    expect(textFor(EExecutionLocation.Host)).toContain(
      "running locally on the operator's machine (the host)",
    )
  })

  it('defaults to host when placement is absent', () => {
    expect(textFor(undefined)).toContain("running locally on the operator's machine (the host)")
  })

  it('describes every pod the same way, never naming the provider behind it', () => {
    const texts = POD_RUNNERS.map((runner) => textFor(EExecutionLocation.Cloud, runner))
    for (const text of texts) {
      expect(text).not.toContain('Vercel')
      expect(text).not.toContain('cloud sandbox')
      expect(text).toContain('/atlas/workspaces/<repo-name>')
      expect(text).toContain('repositories the project configures are cloned beside it')
      expect(text).toContain("run the project's own install")
    }
  })

  it('tells a pod that idle parking clears /tmp and where durable files belong', () => {
    for (const runner of POD_RUNNERS) {
      const text = textFor(EExecutionLocation.Cloud, runner)
      expect(text).toContain(`After ${DEFAULT_CONTAINER_IDLE_MINUTES} minutes without activity`)
      expect(text).toContain('parking clears /tmp')
      expect(text).toContain('ATLAS_SESSION_DIR or /atlas/workspaces')
    }
  })

  it('tells a pod to leave leftovers in place because the pod is discarded', () => {
    for (const runner of POD_RUNNERS) {
      expect(textFor(EExecutionLocation.Cloud, runner)).toContain(
        'leave worktrees, clones, and scratch files in place',
      )
    }
  })

  it('keeps pod facts out of sessions that run on the operator machine', () => {
    for (const placement of [EExecutionLocation.Host, EExecutionLocation.Docker, undefined]) {
      const text = textFor(placement)
      expect(text).not.toContain('/atlas/workspaces')
      expect(text).not.toContain('leave worktrees')
    }
  })

  it('adds loopback port publishing only for a pod on the operator machine', () => {
    const local = textFor(EExecutionLocation.Cloud, ERunner.Local)
    expect(local).toContain('exposePort')
    expect(local).toContain('0.0.0.0')
    expect(local).toContain('.sandbox.localhost')
    expect(textFor(EExecutionLocation.Cloud, ERunner.Vercel)).not.toContain('.sandbox.localhost')
  })

  it('no longer describes the retired lift/descend machinery', () => {
    const text = textFor()
    expect(text).not.toContain('Lift and descend')
    expect(text).not.toContain('descend leaves them behind')
  })

  it('stamps the runner so a local pod and a remote pod never share a cache entry', () => {
    const fragment = new ExecutionLocationFragment()
    expect(fragment.stamp(ctx(EExecutionLocation.Cloud, ERunner.Local))).not.toBe(
      fragment.stamp(ctx(EExecutionLocation.Cloud, ERunner.Vercel)),
    )
  })
})

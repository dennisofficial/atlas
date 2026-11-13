import { describe, expect, it } from 'bun:test'
import {
  EEffort,
  EFinishReason,
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  ERunFailureKind,
  ModelPort,
  type Assembled,
  type ModelChoice,
  type ModelRef,
  type ModelStepResult,
  type ProviderIdentity,
} from '@dltech/atlas-core'
import { TurnFault, type NormalizeFailure } from '@dltech/atlas-agent'

import type { RoleModelRequest } from '../../ports'
import { childChoiceOf, childModelOf } from '../child-model'

const MAIN: ModelChoice = {
  ref: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
  effort: EEffort.High,
  fast: true,
}

const OWN: ModelChoice = {
  ref: { providerId: 'openai', modelId: 'gpt-5' },
  effort: EEffort.Low,
  fast: false,
}

const ASSEMBLED = { sections: [] } as unknown as Assembled
const DONE: ModelStepResult = { parts: [], toolCalls: [], finishReason: EFinishReason.Stop }

class FakeModel extends ModelPort {
  calls = 0

  constructor(
    private readonly label: string,
    private readonly fault?: unknown,
  ) {
    super()
  }

  get identity(): ProviderIdentity {
    return { id: 'fake', modelId: this.label }
  }

  async step(): Promise<ModelStepResult> {
    this.calls += 1
    if (this.fault !== undefined) throw this.fault
    return DONE
  }
}

const networkFailure: NormalizeFailure = ({ message }) => ({
  kind: EProviderFailureKind.Network,
  scope: EProviderFailureScope.Route,
  retry: EProviderRetry.Transient,
  message,
})

const credentialFailure: NormalizeFailure = ({ cause, message }) =>
  cause instanceof TurnFault
    ? {
        kind: EProviderFailureKind.Auth,
        scope: EProviderFailureScope.Credential,
        retry: EProviderRetry.Never,
        message,
      }
    : networkFailure({ cause, message, nowMs: 0 })

const runtimeOver = (args: {
  choice?: (ModelChoice & { unavailable?: ModelRef | undefined }) | undefined
  child?: ModelPort | undefined
  normalizeFailure?: NormalizeFailure | undefined
}) => {
  const calls: RoleModelRequest[] = []
  const child = args.child ?? new FakeModel('child')
  const main = new FakeModel('main')
  const runtime = {
    modelChoice: MAIN,
    model: main,
    modelFor: (request: RoleModelRequest) => {
      calls.push(request)
      return child
    },
    choiceFor: () => args.choice ?? MAIN,
    normalizeFailure: args.normalizeFailure ?? networkFailure,
  }
  return { calls, runtime, child, main }
}

const request = { role: { agentType: 'builder' }, root: MAIN } as const
const signal = new AbortController().signal

describe('childModelOf', () => {
  it('asks the runtime for the agent type’s model, rooted at the session’s choice', () => {
    const { calls, runtime, child } = runtimeOver({})
    expect(childModelOf({ runtime, agentType: 'builder' })).toBe(child)
    expect(calls).toEqual([request])
  })

  it('asks once per child and names only the child’s own agent type', () => {
    const { calls, runtime } = runtimeOver({})
    childModelOf({ runtime, agentType: 'builder' })
    childModelOf({ runtime, agentType: 'reviewer' })
    expect(calls.map((call) => call.role)).toEqual([
      { agentType: 'builder' },
      { agentType: 'reviewer' },
    ])
  })

  it('carries the model a stale child was moved off as unavailable', () => {
    const unavailable: ModelRef = OWN.ref
    const { runtime } = runtimeOver({ choice: { ...MAIN, unavailable } })
    expect(childChoiceOf({ runtime, agentType: 'builder' })).toMatchObject({
      ref: MAIN.ref,
      unavailable,
    })
  })

  it('does not wrap a child that already runs Main’s model', async () => {
    const child = new FakeModel(
      'child',
      new TurnFault({ kind: ERunFailureKind.MissingCredential, message: 'x' }),
    )
    const { runtime } = runtimeOver({ child, normalizeFailure: credentialFailure })
    const model = childModelOf({ runtime, agentType: 'builder', onFallback: () => {} })
    expect(model).toBe(child)
    await expect(model.step({ assembled: ASSEMBLED, tools: [], signal })).rejects.toBeInstanceOf(
      TurnFault,
    )
  })

  it('retries the step once on Main’s model after the child’s credential fails', async () => {
    const fellBack: { from: ModelRef; to: ModelRef }[] = []
    const child = new FakeModel(
      'child',
      new TurnFault({ kind: ERunFailureKind.MissingCredential, message: 'no openai account' }),
    )
    const { runtime, main } = runtimeOver({
      choice: OWN,
      child,
      normalizeFailure: credentialFailure,
    })
    const model = childModelOf({
      runtime,
      agentType: 'builder',
      onFallback: (refs) => {
        fellBack.push(refs)
      },
    })
    expect(await model.step({ assembled: ASSEMBLED, tools: [], signal })).toEqual(DONE)
    expect(child.calls).toBe(1)
    expect(main.calls).toBe(1)
    expect(fellBack).toEqual([{ from: OWN.ref, to: MAIN.ref }])
    expect(model.identity.modelId).toBe('main')
  })

  it('switches for the rest of the run, without asking the child again', async () => {
    const child = new FakeModel(
      'child',
      new TurnFault({ kind: ERunFailureKind.MissingCredential, message: 'no openai account' }),
    )
    const { runtime, main } = runtimeOver({
      choice: OWN,
      child,
      normalizeFailure: credentialFailure,
    })
    const model = childModelOf({ runtime, agentType: 'builder', onFallback: () => {} })
    await model.step({ assembled: ASSEMBLED, tools: [], signal })
    await model.step({ assembled: ASSEMBLED, tools: [], signal })
    expect(child.calls).toBe(1)
    expect(main.calls).toBe(2)
  })

  it('rethrows a non-credential failure without falling back or reporting', async () => {
    const fellBack: unknown[] = []
    const child = new FakeModel('child', new Error('network down'))
    const { runtime, main } = runtimeOver({ choice: OWN, child })
    const model = childModelOf({
      runtime,
      agentType: 'builder',
      onFallback: (refs) => {
        fellBack.push(refs)
      },
    })
    await expect(model.step({ assembled: ASSEMBLED, tools: [], signal })).rejects.toThrow(
      'network down',
    )
    expect(main.calls).toBe(0)
    expect(fellBack).toEqual([])
  })

  it('rethrows the child’s fault when the run was aborted', async () => {
    const aborted = new AbortController()
    aborted.abort()
    const child = new FakeModel(
      'child',
      new TurnFault({ kind: ERunFailureKind.MissingCredential, message: 'no openai account' }),
    )
    const { runtime, main } = runtimeOver({
      choice: OWN,
      child,
      normalizeFailure: credentialFailure,
    })
    const model = childModelOf({ runtime, agentType: 'builder', onFallback: () => {} })
    await expect(
      model.step({ assembled: ASSEMBLED, tools: [], signal: aborted.signal }),
    ).rejects.toBeInstanceOf(TurnFault)
    expect(main.calls).toBe(0)
  })

  it('falls back when the normalizer calls the fault a credential rejection', async () => {
    const alwaysCredential: NormalizeFailure = ({ message }) => ({
      kind: EProviderFailureKind.Quota,
      scope: EProviderFailureScope.Credential,
      retry: EProviderRetry.Never,
      message,
    })
    const child = new FakeModel('child', new Error('429 out of credits'))
    const { runtime, main } = runtimeOver({
      choice: OWN,
      child,
      normalizeFailure: alwaysCredential,
    })
    const model = childModelOf({ runtime, agentType: 'builder', onFallback: () => {} })
    await model.step({ assembled: ASSEMBLED, tools: [], signal })
    expect(main.calls).toBe(1)
  })
})

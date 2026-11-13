import { describe, expect, it } from 'bun:test'
import { EEffort, type ModelChoice, type ModelPort } from '@dltech/atlas-core'

import type { RoleModelRequest } from '../../ports'
import { childModelOf } from '../child-model'

const MAIN: ModelChoice = {
  ref: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
  effort: EEffort.High,
  fast: true,
}

const port = { identity: { model: 'child' } } as unknown as ModelPort

const runtimeOver = () => {
  const calls: RoleModelRequest[] = []
  return {
    calls,
    runtime: {
      modelChoice: MAIN,
      modelFor: (request: RoleModelRequest) => {
        calls.push(request)
        return port
      },
    },
  }
}

describe('childModelOf', () => {
  it('asks the runtime for the agent type’s model, rooted at the session’s choice', () => {
    const { calls, runtime } = runtimeOver()
    expect(childModelOf({ runtime, agentType: 'builder' })).toBe(port)
    expect(calls).toEqual([{ role: { agentType: 'builder' }, root: MAIN }])
  })

  it('asks once per child and names only the child’s own agent type', () => {
    const { calls, runtime } = runtimeOver()
    childModelOf({ runtime, agentType: 'builder' })
    childModelOf({ runtime, agentType: 'reviewer' })
    expect(calls.map((call) => call.role)).toEqual([
      { agentType: 'builder' },
      { agentType: 'reviewer' },
    ])
  })
})

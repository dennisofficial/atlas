import { describe, expect, it } from 'bun:test'

import { callKindOf, ECallKind } from '../call-kind'

describe('callKindOf', () => {
  it('names the kind of each built-in tool', () => {
    expect(callKindOf('bash')).toBe(ECallKind.Shell)
    expect(callKindOf('read')).toBe(ECallKind.Read)
    expect(callKindOf('read_image')).toBe(ECallKind.Read)
    expect(callKindOf('grep')).toBe(ECallKind.Search)
    expect(callKindOf('glob')).toBe(ECallKind.Search)
    expect(callKindOf('edit')).toBe(ECallKind.Edit)
    expect(callKindOf('multi_edit')).toBe(ECallKind.Edit)
    expect(callKindOf('write')).toBe(ECallKind.Edit)
    expect(callKindOf('web_fetch')).toBe(ECallKind.Web)
    expect(callKindOf('web_search')).toBe(ECallKind.Web)
    expect(callKindOf('skill')).toBe(ECallKind.Skill)
    expect(callKindOf('task_write')).toBe(ECallKind.Plan)
  })

  it('reads every agent tool as an agent call', () => {
    expect(callKindOf('agent_spawn')).toBe(ECallKind.Agent)
    expect(callKindOf('agent_stop')).toBe(ECallKind.Agent)
  })

  it('reads any other tool as other', () => {
    expect(callKindOf('memory')).toBe(ECallKind.Other)
    expect(callKindOf('mcp__Posthog__exec')).toBe(ECallKind.Other)
  })
})

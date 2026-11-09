import { describe, expect, it } from 'bun:test'

import { PLAN_TOOL_NAME, toThreadId, type ToolCall, type ToolOutcome } from '@dltech/atlas-core'

import { MirrorPlanHook } from '../plan-mirror'

const callOf = (args: { name: string; input: unknown }): ToolCall =>
  ({
    id: 'call-1',
    name: args.name,
    input: args.input,
    threadId: toThreadId('thr-1'),
  }) as ToolCall

const okResult: ToolOutcome = { ok: true, output: { tasks: [] }, modelText: 'No plan yet.' }

const run = (args: { call: ToolCall; result?: ToolOutcome }) =>
  new MirrorPlanHook().run({
    call: args.call,
    result: args.result ?? okResult,
    projectDirectory: '/work/repo',
    signal: new AbortController().signal,
  })

describe('MirrorPlanHook', () => {
  it('carries the plan into the next step as context', async () => {
    const outcome = await run({
      call: callOf({
        name: PLAN_TOOL_NAME,
        input: { tasks: [{ text: 'Build the tool', status: 'in_progress' }] },
      }),
    })

    expect(outcome.additionalContext).toContain('Your plan, as you last wrote it with task_write')
    expect(outcome.additionalContext).toContain('#1 [in_progress] Build the tool')
  })

  it('says the plan is cleared when the list comes back empty', async () => {
    const outcome = await run({ call: callOf({ name: PLAN_TOOL_NAME, input: { tasks: [] } }) })

    expect(outcome.additionalContext).toContain('You have no plan written')
  })

  it('ignores every other tool', async () => {
    const outcome = await run({
      call: callOf({ name: 'read', input: { path: '/work/repo/a.ts' } }),
    })

    expect(outcome).toEqual({})
  })

  it('ignores a failed call', async () => {
    const outcome = await run({
      call: callOf({ name: PLAN_TOOL_NAME, input: { tasks: [{ text: 'x' }] } }),
      result: { ok: false, reason: 'refused' },
    })

    expect(outcome).toEqual({})
  })

  it('ignores an input the schema refuses', async () => {
    const outcome = await run({ call: callOf({ name: PLAN_TOOL_NAME, input: { tasks: 'nope' } }) })

    expect(outcome).toEqual({})
  })
})

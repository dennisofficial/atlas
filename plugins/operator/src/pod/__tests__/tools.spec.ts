import { describe, expect, it } from 'bun:test'

import { isParkedOutcome, toThreadId } from '@dltech/atlas-core'
import {
  EMPTY_CREW,
  EMPTY_MCP_CONTROL,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
  type PodControl,
} from '@dltech/atlas-plugin-sdk'

import { operatorPod } from '..'
import { EOperatorRequestKind, OPERATOR_INPUT_TOOL, OPERATOR_SHELL_INPUT_TOOL } from '../../core'

const SHELL_ID = 'shell-9f2c1a04'

const unavailable = async (): Promise<never> => {
  throw new Error('this spec has no control plane')
}

const control: PodControl = {
  exposePort: unavailable,
  mcp: EMPTY_MCP_CONTROL,
  webSearch: { config: unavailable },
  memory: {
    list: unavailable,
    read: unavailable,
    write: unavailable,
    edit: unavailable,
    delete: unavailable,
  },
}

const ctx: PluginPodContext = {
  sessionId: 's1',
  control,
  crew: EMPTY_CREW,
  sessions: EMPTY_SESSIONS,
  worktrees: EMPTY_WORKTREES,
  append: async () => undefined,
  events: () => [],
  call: unavailable,
  live: () => undefined,
  onDaemonEvent: () => () => undefined,
  log: () => undefined,
}

const invoke = async (args: { name: string; input: unknown }) => {
  const tool = operatorPod.tools?.(ctx).find((candidate) => candidate.name === args.name)
  if (tool === undefined) throw new Error(`${args.name} is not registered`)
  return await tool.invoke({
    input: args.input,
    signal: new AbortController().signal,
    idempotencyKey: 'k1',
    projectDirectory: '/w',
    threadId: toThreadId('t1'),
  })
}

describe('the operator pod tools', () => {
  it('parks operator_input with the question as its request', async () => {
    const outcome = await invoke({
      name: OPERATOR_INPUT_TOOL,
      input: { prompt: 'What is the login code?' },
    })

    expect(isParkedOutcome(outcome)).toBe(true)
    if (!isParkedOutcome(outcome)) return
    expect(outcome.request).toEqual({
      kind: EOperatorRequestKind.Input,
      prompt: 'What is the login code?',
    })
  })

  it('parks operator_shell_input with the shell it types into', async () => {
    const outcome = await invoke({
      name: OPERATOR_SHELL_INPUT_TOOL,
      input: { prompt: 'Paste the code at the prompt', shellId: SHELL_ID },
    })

    expect(isParkedOutcome(outcome)).toBe(true)
    if (!isParkedOutcome(outcome)) return
    expect(outcome.request).toEqual({
      kind: EOperatorRequestKind.Shell,
      prompt: 'Paste the code at the prompt',
      shellId: SHELL_ID,
    })
  })

  it('rejects a call with no question', async () => {
    const outcome = await invoke({ name: OPERATOR_INPUT_TOOL, input: {} })

    expect(isParkedOutcome(outcome)).toBe(false)
    expect(outcome.ok).toBe(false)
  })

  it('keeps both tools away from a sub-agent', () => {
    expect(operatorPod.childDeny).toEqual([OPERATOR_INPUT_TOOL, OPERATOR_SHELL_INPUT_TOOL])
  })

  it('tells the model the wait has no deadline and where the value goes', () => {
    const [input, shell] = operatorPod.tools?.(ctx) ?? []

    expect(input?.description).toContain('no deadline')
    expect(input?.description).toContain('$ATLAS_SESSION_DIR/requests')
    expect(shell?.description).toContain('no deadline')
  })
})

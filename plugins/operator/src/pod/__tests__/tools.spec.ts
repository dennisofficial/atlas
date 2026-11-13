import { describe, expect, it } from 'bun:test'

import { isParkedOutcome, toThreadId } from '@dltech/atlas-core'
import {
  EMPTY_CREW,
  EMPTY_MCP_CONTROL,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
  type PodControl,
  type PodOperatorAsk,
  type PodOperatorOpened,
} from '@dltech/atlas-plugin-sdk'

import { operatorPod } from '..'

const REQUEST = 'oreq_1'
const SHELL_ID = 'shell-9f2c1a04'

const unavailable = async (): Promise<never> => {
  throw new Error('this spec has no control plane')
}

const controlWith = (
  ask: (args: { ask: PodOperatorAsk; signal: AbortSignal }) => Promise<PodOperatorOpened>,
): PodControl => ({
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
  operator: { ask },
})

const rig = (opened: PodOperatorOpened) => {
  const asks: PodOperatorAsk[] = []
  const ctx: PluginPodContext = {
    sessionId: 's1',
    control: controlWith(async ({ ask }) => {
      asks.push(ask)
      return opened
    }),
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
    if (tool === undefined) throw new Error(`no tool ${args.name}`)
    return await tool.invoke({
      input: args.input,
      signal: new AbortController().signal,
      idempotencyKey: 'k',
      projectDirectory: '/work',
      threadId: toThreadId('t1'),
    })
  }

  return { asks, ctx, invoke }
}

describe('operator_input', () => {
  it('asks the operator with the schema values, defaulting secret to false', async () => {
    const harness = rig({ ok: true, requestId: REQUEST })

    await harness.invoke({ name: 'operator_input', input: { prompt: 'Login code?' } })
    await harness.invoke({
      name: 'operator_input',
      input: { prompt: 'API token?', secret: true },
    })

    expect(harness.asks).toEqual([
      { kind: 'input', prompt: 'Login code?', secret: false },
      { kind: 'input', prompt: 'API token?', secret: true },
    ])
  })

  it('parks the call naming the open request instead of waiting', async () => {
    const harness = rig({ ok: true, requestId: REQUEST })
    const outcome = await harness.invoke({
      name: 'operator_input',
      input: { prompt: 'Login code?', secret: true },
    })

    expect(isParkedOutcome(outcome)).toBe(true)
    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.reason).toContain(REQUEST)
    expect(!outcome.ok && outcome.reason).toContain("arrives as this call's result")
  })

  it('turns a refusal into a sentence naming the reason and the missing value', async () => {
    const harness = rig({ ok: false, reason: 'cancelled' })
    const outcome = await harness.invoke({
      name: 'operator_input',
      input: { prompt: 'Login code?' },
    })

    expect(outcome.ok).toBe(false)
    expect(isParkedOutcome(outcome)).toBe(false)
    expect(!outcome.ok && outcome.reason).toContain('cancelled')
    expect(!outcome.ok && outcome.reason).toContain('No value arrived')
  })
})

describe('operator_shell_input', () => {
  it('asks the operator for a shell kind with the shellId it was given', async () => {
    const harness = rig({ ok: true, requestId: REQUEST })

    await harness.invoke({
      name: 'operator_shell_input',
      input: { prompt: 'Login code?', shellId: SHELL_ID },
    })

    expect(harness.asks).toEqual([
      { kind: 'shell', prompt: 'Login code?', secret: false, shellId: SHELL_ID },
    ])
  })

  it('parks the shell ask the same way', async () => {
    const harness = rig({ ok: true, requestId: REQUEST })
    const outcome = await harness.invoke({
      name: 'operator_shell_input',
      input: { prompt: 'Login code?', shellId: SHELL_ID, secret: true },
    })

    expect(isParkedOutcome(outcome)).toBe(true)
    expect(!outcome.ok && outcome.reason).toContain(REQUEST)
  })

  it('names the reason when the host could not open the request', async () => {
    const harness = rig({ ok: false, reason: 'this session has no owner to ask for input' })
    const outcome = await harness.invoke({
      name: 'operator_shell_input',
      input: { prompt: 'Login code?', shellId: SHELL_ID },
    })

    expect(!outcome.ok && outcome.reason).toContain('no owner')
  })
})

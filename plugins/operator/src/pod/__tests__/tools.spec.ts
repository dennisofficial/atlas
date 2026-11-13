import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import {
  EMPTY_CREW,
  EMPTY_MCP_CONTROL,
  EMPTY_SESSIONS,
  EMPTY_WORKTREES,
  type PluginPodContext,
  type PodControl,
  type PodOperatorAsk,
  type PodOperatorDelivery,
} from '@dltech/atlas-plugin-sdk'

import { operatorPod } from '..'
import { OperatorInputFragment } from '../fragment'

const PATH = '/atlas/sessions/s1/requests/req_1'
const SHELL_ID = 'shell-9f2c1a04'
const MARKED_VALUE = 'operator-value-9f2c-marker'

const unavailable = async (): Promise<never> => {
  throw new Error('this spec has no control plane')
}

const controlWith = (
  ask: (args: { ask: PodOperatorAsk; signal: AbortSignal }) => Promise<PodOperatorDelivery>,
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

const rig = (delivery: PodOperatorDelivery) => {
  const asks: PodOperatorAsk[] = []
  const held: string[] = []
  const ctx: PluginPodContext = {
    sessionId: 's1',
    control: controlWith(async ({ ask }) => {
      asks.push(ask)
      held.push(MARKED_VALUE)
      return delivery
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

  return { asks, held, ctx, invoke }
}

const textOf = (outcome: Awaited<ReturnType<ReturnType<typeof rig>['invoke']>>): string =>
  outcome.ok ? outcome.modelText : outcome.reason

describe('operator_input', () => {
  it('asks the operator with the schema values, defaulting secret to false', async () => {
    const harness = rig({ ok: true, path: PATH, bytes: 12 })

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

  it('returns the path sentence and the file it names', async () => {
    const harness = rig({ ok: true, path: PATH, bytes: 12 })
    const outcome = await harness.invoke({
      name: 'operator_input',
      input: { prompt: 'Login code?', secret: true },
    })

    expect(textOf(outcome)).toBe(
      `the operator's value was written to ${PATH} (12 bytes, mode 0600). Read it from there and never paste it into a message.`,
    )
    expect(outcome.ok && outcome.output).toEqual({ path: PATH, bytes: 12 })
  })

  it('turns a refusal into a sentence naming the reason and the missing value', async () => {
    const harness = rig({ ok: false, reason: 'cancelled' })
    const outcome = await harness.invoke({
      name: 'operator_input',
      input: { prompt: 'Login code?' },
    })

    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('cancelled')
    expect(textOf(outcome)).toContain('No value arrived')
  })

  it('carries the path and never the value the operator typed', async () => {
    const harness = rig({ ok: true, path: PATH, bytes: MARKED_VALUE.length })
    const outcome = await harness.invoke({
      name: 'operator_input',
      input: { prompt: 'Login code?', secret: true },
    })

    expect(harness.held).toEqual([MARKED_VALUE])
    expect(textOf(outcome)).toContain(PATH)
    expect(textOf(outcome)).not.toContain(MARKED_VALUE)
    expect(JSON.stringify(outcome)).not.toContain(MARKED_VALUE)
  })
})

describe('operator_shell_input', () => {
  it('asks the operator for a shell kind with the shellId it was given', async () => {
    const harness = rig({ ok: true, shellId: SHELL_ID, bytes: 8 })

    await harness.invoke({
      name: 'operator_shell_input',
      input: { prompt: 'Paste the code gh printed', shellId: SHELL_ID },
    })

    expect(harness.asks).toEqual([
      { kind: 'shell', prompt: 'Paste the code gh printed', secret: false, shellId: SHELL_ID },
    ])
  })

  it('returns the shell sentence and the shell it wrote to', async () => {
    const harness = rig({ ok: true, shellId: SHELL_ID, bytes: 8 })
    const outcome = await harness.invoke({
      name: 'operator_shell_input',
      input: { prompt: 'Paste the code gh printed', secret: true, shellId: SHELL_ID },
    })

    expect(textOf(outcome)).toBe(
      `the operator's value was typed into the stdin of shell ${SHELL_ID} (8 bytes). Read the shell's output to see what the CLI did with it.`,
    )
    expect(outcome.ok && outcome.output).toEqual({ shellId: SHELL_ID, bytes: 8 })
  })

  it('turns an expired request into a sentence saying no value arrived', async () => {
    const harness = rig({ ok: false, reason: 'expired' })
    const outcome = await harness.invoke({
      name: 'operator_shell_input',
      input: { prompt: 'Paste the code gh printed', shellId: SHELL_ID },
    })

    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('expired')
    expect(textOf(outcome)).toContain('No value arrived')
    expect(textOf(outcome)).not.toContain(MARKED_VALUE)
  })
})

describe('the operator pod slot', () => {
  it('offers both tools and hides them from a sub-agent', () => {
    const { ctx } = rig({ ok: false, reason: 'cancelled' })

    expect(operatorPod.tools?.(ctx).map((tool) => tool.name)).toEqual([
      'operator_input',
      'operator_shell_input',
    ])
    expect(operatorPod.childDeny).toEqual(['operator_input', 'operator_shell_input'])
  })

  it('tells the model the value lands at a path it reads', () => {
    const text = new OperatorInputFragment().text()

    expect(text).toContain('operator_input')
    expect(text).toContain('path')
    expect(text).toContain('Never echo')
  })
})

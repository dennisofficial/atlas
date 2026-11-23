import { describe, expect, it } from 'bun:test'

import {
  EToolEffect,
  toCallId,
  toThreadId,
  type ToolCall,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { adoptedShellHook } from '../adopted-shell'
import { stateFor } from '../state'
import { rig } from './support'

const SHELL_ID = 'shell-1a2b3c4d'

const bashCall = (input: Record<string, unknown> = { command: 'bun test' }): ToolCall => ({
  callId: toCallId('c1'),
  name: 'bash',
  input,
  effect: EToolEffect.Destructive,
  threadId: toThreadId('t1'),
})

const backgrounded = (over: Record<string, unknown> = {}): ToolOutcome => ({
  ok: true,
  output: {
    command: 'bun test',
    description: 'Run the suite',
    shellId: SHELL_ID,
    backgrounded: true,
    timedOut: false,
    stdout: 'compiling\n',
    stderr: '',
    truncated: false,
    ...over,
  },
  modelText: 'still running',
})

const settle = async (): Promise<void> => {
  for (let turns = 0; turns < 20; turns += 1) await Bun.sleep(1)
}

const run = async (args: {
  harness: ReturnType<typeof rig>
  result: ToolOutcome
  input?: Record<string, unknown>
  projectDirectory?: string
}) =>
  adoptedShellHook({ ctx: args.harness.ctx, state: stateFor(args.harness.ctx) }).run({
    call: bashCall(args.input),
    result: args.result,
    projectDirectory: args.projectDirectory ?? '/work',
    signal: new AbortController().signal,
  })

describe('a bash call the daemon moved to the background', () => {
  it('records the start of the shell the call became, with where it ran', async () => {
    const harness = rig()

    const outcome = await run({
      harness,
      result: backgrounded(),
      input: { command: 'bun test', workdir: '/elsewhere' },
    })

    expect(outcome.drafts).toEqual([
      {
        type: 'background-shell-started',
        shellId: SHELL_ID,
        command: 'bun test',
        description: 'Run the suite',
        cwd: '/elsewhere',
      },
    ])
  })

  it('falls back to the project directory for a command with no workdir', async () => {
    const harness = rig()

    const outcome = await run({ harness, result: backgrounded() })

    expect(outcome.drafts).toEqual([
      {
        type: 'background-shell-started',
        shellId: SHELL_ID,
        command: 'bun test',
        description: 'Run the suite',
        cwd: '/work',
      },
    ])
  })

  it('leaves the row alone when the ending already recorded it', async () => {
    const harness = rig()
    await harness.ctx.append([
      { type: 'background-shell-started', shellId: SHELL_ID, command: 'bun test' },
    ])

    const outcome = await run({ harness, result: backgrounded() })

    expect(outcome).toEqual({})
    expect(harness.log.filter((event) => event.type === 'background-shell-started')).toHaveLength(1)
  })

  it('ignores a command that finished inside its window', async () => {
    const harness = rig()

    const outcome = await run({
      harness,
      result: backgrounded({ backgrounded: false, shellId: undefined }),
    })

    expect(outcome).toEqual({})
    expect(harness.log).toHaveLength(0)
  })

  it('ignores a failed call and every tool but bash', async () => {
    const harness = rig()

    expect(await run({ harness, result: { ok: false, reason: 'interrupted' } })).toEqual({})
    const other = await adoptedShellHook({
      ctx: harness.ctx,
      state: stateFor(harness.ctx),
    }).run({
      call: { ...bashCall(), name: 'grep' },
      result: backgrounded(),
      projectDirectory: '/work',
      signal: new AbortController().signal,
    })
    expect(other).toEqual({})
  })

  it('streams the adopted shell live, so its output reaches the operator', async () => {
    const harness = rig()

    await run({ harness, result: backgrounded() })
    await settle()

    expect(harness.calls.some((op) => op.op === 'shells.read' && op.shellId === SHELL_ID)).toBe(
      true,
    )
  })
})

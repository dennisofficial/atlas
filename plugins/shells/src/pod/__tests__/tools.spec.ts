import { describe, expect, it } from 'bun:test'

import { EShellRunStatus } from '@dltech/atlas-protocol'

import { shellsPod } from '..'
import { invoke, rig, shellIdOf, textOf } from './support'

const start = async (
  harness: ReturnType<typeof rig>,
  input: Record<string, unknown> = { command: 'sleep 30' },
) => {
  const outcome = await invoke({ ctx: harness.ctx, name: 'shell', input })
  return { outcome, shellId: shellIdOf(outcome) }
}

describe('shell tools', () => {
  it('declares the five tools', () => {
    const { ctx } = rig()
    expect(shellsPod.tools?.(ctx).map((tool) => tool.name)).toEqual([
      'shell',
      'shell_output',
      'shell_input',
      'shell_kill',
      'shell_list',
    ])
  })

  it('shell launches in the workdir and records the start with its cwd', async () => {
    const harness = rig()
    const { outcome, shellId } = await start(harness, {
      command: 'sleep 30',
      description: 'ticker',
      workdir: '/elsewhere',
      input: true,
    })
    expect(shellId).toMatch(/^shell-[0-9a-f]{8}$/)
    expect(harness.calls[0]).toMatchObject({
      op: 'shells.launch',
      shellId,
      cwd: '/elsewhere',
      input: true,
    })
    expect(harness.shells.has(shellId)).toBe(true)
    expect(harness.log).toMatchObject([
      {
        type: 'background-shell-started',
        shellId,
        command: 'sleep 30',
        description: 'ticker',
        cwd: '/elsewhere',
      },
    ])
    expect(textOf(outcome)).toContain('outlives this turn')
  })

  it('shell falls back to the project directory', async () => {
    const harness = rig()
    await start(harness)
    expect(harness.log[0]).toMatchObject({ cwd: '/work' })
  })

  it('shell_output returns the delta once and nothing the second time', async () => {
    const harness = rig()
    const { shellId } = await start(harness)
    harness.print(shellId, 'tick 1\n')
    const first = await invoke({ ctx: harness.ctx, name: 'shell_output', input: { shellId } })
    expect(textOf(first)).toContain('tick 1')
    const second = await invoke({ ctx: harness.ctx, name: 'shell_output', input: { shellId } })
    expect(textOf(second)).toContain('nothing new')
    expect(textOf(second)).not.toContain('tick 1')
  })

  it('shell_output reports a prompt once as awaiting input', async () => {
    const harness = rig()
    const { shellId } = await start(harness, { command: 'ask', input: true })
    harness.print(shellId, 'Continue? (y/n)')
    const read = await invoke({ ctx: harness.ctx, name: 'shell_output', input: { shellId } })
    expect(textOf(read)).toContain('waiting for input')
    await invoke({ ctx: harness.ctx, name: 'shell_output', input: { shellId } })
    const waiting = harness.log.filter((e) => e.type === 'background-shell-awaiting-input')
    expect(waiting).toMatchObject([{ shellId, output: 'Continue? (y/n)', inputSupported: true }])
  })

  it('shell_input writes to the daemon and clears the awaiting mark', async () => {
    const harness = rig()
    const { shellId } = await start(harness, { command: 'ask', input: true })
    harness.print(shellId, 'Password: ')
    await invoke({ ctx: harness.ctx, name: 'shell_output', input: { shellId } })
    const sent = await invoke({
      ctx: harness.ctx,
      name: 'shell_input',
      input: { shellId, text: 'hunter2\n' },
    })
    expect(harness.calls.at(-1)).toMatchObject({
      op: 'shells.write',
      shellId,
      data: 'hunter2\n',
    })
    expect(textOf(sent)).toContain('Sent input')
    harness.print(shellId, 'Again: ')
    await invoke({ ctx: harness.ctx, name: 'shell_output', input: { shellId } })
    expect(harness.log.filter((e) => e.type === 'background-shell-awaiting-input')).toHaveLength(2)
  })

  it('shell_kill renders the ending once and leaves the journal to the frame listener', async () => {
    const harness = rig()
    const { shellId } = await start(harness)
    harness.print(shellId, 'tick 1\n')
    const killed = await invoke({ ctx: harness.ctx, name: 'shell_kill', input: { shellId } })
    expect(textOf(killed)).toContain(`Killed shell ${shellId}`)
    expect(textOf(killed)).toContain('tick 1')
    expect(harness.log.map((e) => e.type)).toEqual(['background-shell-started'])
    const again = await invoke({ ctx: harness.ctx, name: 'shell_output', input: { shellId } })
    expect(textOf(again)).not.toContain('tick 1')
  })

  it('shell_list lists what the daemon knows, with the description from the journal', async () => {
    const harness = rig()
    const { shellId } = await start(harness, { command: 'sleep 30', description: 'ticker' })
    const listed = await invoke({ ctx: harness.ctx, name: 'shell_list', input: {} })
    expect(textOf(listed)).toContain(shellId)
    expect(textOf(listed)).toContain('"ticker"')
    expect(textOf(listed)).toContain('running')
    const none = await invoke({
      ctx: harness.ctx,
      name: 'shell_list',
      input: { runningOnly: true },
    })
    expect(none.ok).toBe(true)
    harness.finish(shellId, EShellRunStatus.Exited, 0)
    const running = await invoke({
      ctx: harness.ctx,
      name: 'shell_list',
      input: { runningOnly: true },
    })
    expect(textOf(running)).toBe('No background shell is running.')
  })

  it('returns a failure instead of throwing when the daemon refuses', async () => {
    const harness = rig()
    const output = await invoke({
      ctx: harness.ctx,
      name: 'shell_output',
      input: { shellId: 'shell-missing' },
    })
    expect(output).toEqual({ ok: false, reason: 'no shell with id shell-missing' })
    const killed = await invoke({
      ctx: harness.ctx,
      name: 'shell_kill',
      input: { shellId: 'shell-missing' },
    })
    expect(killed.ok).toBe(false)
  })
})

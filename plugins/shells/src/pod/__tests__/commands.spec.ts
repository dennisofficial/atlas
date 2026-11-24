import { describe, expect, it } from 'bun:test'

import type { CommandContext } from '@dltech/atlas-commands'

import { shellKillHandlerOf } from '../commands'
import { stateFor } from '../state'
import { rig, seedShell } from './support'

const contextOf = (args: unknown): CommandContext<unknown> => ({
  args,
  sessionId: 's1',
  inboxId: 9,
  visibleEvents: () => [],
  logEvents: () => [],
  runningChildren: () => 0,
  append: async () => undefined,
  log: () => undefined,
})

const appendedOf = async (args: { harness: ReturnType<typeof rig>; input: unknown }) => {
  const appended: unknown[] = []
  await shellKillHandlerOf(args.harness.ctx)({
    ...contextOf(args.input),
    append: async (drafts) => {
      appended.push(...drafts)
    },
  })
  return appended
}

describe('the shell-kill pod command', () => {
  it('kills the named shell through the daemon', async () => {
    const harness = rig()
    const shellId = await seedShell({ harness })
    const result = await shellKillHandlerOf(harness.ctx)(contextOf({ shellId }))
    expect(result).toEqual({ kind: 'done' })
    expect(harness.calls.at(-1)).toMatchObject({ op: 'shells.kill', shellId })
  })

  it('forgets the awaiting mark of the killed shell', async () => {
    const harness = rig()
    const shellId = await seedShell({ harness, input: true })
    stateFor(harness.ctx).awaiting.add(shellId)
    await shellKillHandlerOf(harness.ctx)(contextOf({ shellId }))
    expect(stateFor(harness.ctx).awaiting.has(shellId)).toBe(false)
  })

  it('refuses with the daemon sentence when the kill fails', async () => {
    const harness = rig()
    const result = await shellKillHandlerOf(harness.ctx)(contextOf({ shellId: 'ghost' }))
    expect(result).toEqual({ kind: 'refused', reason: 'no shell with id ghost' })
  })

  it('refuses arguments that do not parse', async () => {
    const harness = rig()
    const result = await shellKillHandlerOf(harness.ctx)(contextOf({ shellId: '' }))
    expect(result.kind).toBe('refused')
  })
})

describe('the outcome the shell-kill pod command records', () => {
  it('records one applied outcome naming the inbox it answers, after the kill', async () => {
    const harness = rig()
    const shellId = await seedShell({ harness })
    expect(await appendedOf({ harness, input: { shellId } })).toEqual([
      { type: 'command-applied', inboxId: 9, name: 'shell-kill' },
    ])
  })

  it('records no outcome when the kill fails', async () => {
    const harness = rig()
    expect(await appendedOf({ harness, input: { shellId: 'ghost' } })).toEqual([])
  })
})

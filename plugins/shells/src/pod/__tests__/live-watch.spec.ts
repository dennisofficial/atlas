import { describe, expect, it } from 'bun:test'

import { EShellRunStatus } from '@dltech/atlas-protocol'

import { LIVE_READ_LIMIT } from '../live-watch'
import { shellsPod } from '..'
import { invoke, rig, shellIdOf, textOf } from './support'

const listening = async (input: Record<string, unknown> = { command: 'ticker' }) => {
  const harness = rig()
  shellsPod.hooks?.(harness.ctx)
  const outcome = await invoke({ ctx: harness.ctx, name: 'shell', input })
  return { harness, shellId: shellIdOf(outcome) }
}

const settle = async (): Promise<void> => {
  for (let turns = 0; turns < 20; turns += 1) await Bun.sleep(1)
}

describe('streaming a running shell', () => {
  it('publishes the bytes a shells.output frame announces, from its own cursor', async () => {
    const { harness, shellId } = await listening()

    harness.print(shellId, 'tick 1\n')
    harness.output(shellId)
    await settle()

    expect(harness.liveFrames).toEqual([
      { type: 'shell-output', shellId, offset: 0, text: 'tick 1\n' },
    ])

    harness.print(shellId, 'tick 2\n')
    harness.output(shellId)
    await settle()

    expect(harness.liveFrames.at(-1)).toEqual({
      type: 'shell-output',
      shellId,
      offset: 7,
      text: 'tick 2\n',
    })
  })

  it('publishes nothing when the frame announces no new bytes', async () => {
    const { harness, shellId } = await listening()
    harness.print(shellId, 'tick 1\n')
    harness.output(shellId)
    await settle()
    const published = harness.liveFrames.length

    harness.output(shellId)
    await settle()

    expect(harness.liveFrames).toHaveLength(published)
  })

  it('leaves the cursor the model reads through untouched', async () => {
    const { harness, shellId } = await listening()
    harness.print(shellId, 'tick 1\ntick 2\n')
    harness.output(shellId)
    await settle()

    const read = await invoke({ ctx: harness.ctx, name: 'shell_output', input: { shellId } })

    expect(textOf(read)).toContain('tick 1\ntick 2')
  })

  it('forgets a shell when its ending arrives', async () => {
    const { harness, shellId } = await listening()
    harness.print(shellId, 'tick 1\n')
    harness.output(shellId)
    await settle()
    harness.finish(shellId, EShellRunStatus.Exited, 0)
    await settle()

    harness.print(shellId, 'after\n')
    harness.output(shellId)
    await settle()

    expect(harness.liveFrames.at(-1)).toEqual({
      type: 'shell-output',
      shellId,
      offset: 0,
      text: 'tick 1\nafter\n',
    })
  })
})

describe('a shell that prints faster than one page', () => {
  const settle = async (): Promise<void> => {
    for (let turns = 0; turns < 100; turns += 1) await Bun.sleep(1)
  }

  it('drains the whole backlog from one notification', async () => {
    const { harness, shellId } = await listening()
    const printed = 'x'.repeat(LIVE_READ_LIMIT * 2 + 100)
    harness.print(shellId, printed)

    harness.output(shellId)
    await settle()

    const published = harness.liveFrames.flatMap((frame) =>
      frame.type === 'shell-output' ? [frame.text] : [],
    )
    expect(published.length).toBeGreaterThan(1)
    expect(published.join('')).toBe(printed)
  })

  it('keeps a character split across two pages intact and its offsets contiguous', async () => {
    const { harness, shellId } = await listening()
    const printed = `${'a'.repeat(LIVE_READ_LIMIT - 1)}€z`
    harness.print(shellId, printed)

    harness.output(shellId)
    await settle()

    const frames = harness.liveFrames.flatMap((frame) =>
      frame.type === 'shell-output' ? [frame] : [],
    )
    expect(frames.map((frame) => frame.text).join('')).toBe(printed)
    expect(frames.map((frame) => frame.offset)).toEqual(
      frames.map((_, index) =>
        frames.slice(0, index).reduce((sum, frame) => sum + frame.text.length, 0),
      ),
    )
  })
})

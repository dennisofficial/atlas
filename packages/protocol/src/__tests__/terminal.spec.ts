import { describe, expect, it } from 'bun:test'

import {
  terminalListOutputSchema,
  terminalMutationOutputSchema,
  terminalOpenOutputSchema,
  terminalRenameInputSchema,
  terminalRowSchema,
  terminalStreamAttachInputSchema,
  terminalStreamFrameSchema,
  terminalStreamOutputSchema,
  TERMINAL_STREAM_BUFFER_BYTES,
} from '../terminal'

const row = {
  terminalId: 'term-1',
  ordinal: 1,
  name: 'Terminal 1',
  state: 'open',
  exitCode: null,
  signal: null,
  endedReason: null,
  createdAt: 1,
  endedAt: null,
} as const

describe('terminal schemas', () => {
  it('round-trips a row and a list', () => {
    expect(terminalRowSchema.parse(row)).toEqual(row)
    const ended = {
      ...row,
      state: 'ended' as const,
      exitCode: 3,
      endedReason: 'exited' as const,
      endedAt: 2,
    }
    expect(terminalListOutputSchema.parse({ terminals: [row, ended] })).toEqual({
      terminals: [row, ended],
    })
  })

  it('rejects an unknown row field', () => {
    expect(terminalRowSchema.safeParse({ ...row, cwd: '/work' }).success).toBe(false)
  })

  it('accepts a parked answer for open and for a plain mutation', () => {
    expect(terminalOpenOutputSchema.parse({ state: 'parked' })).toEqual({ state: 'parked' })
    expect(terminalMutationOutputSchema.parse({ state: 'parked' })).toEqual({ state: 'parked' })
    expect(
      terminalOpenOutputSchema.parse({ state: 'open', terminalId: 'term-1', pid: 42 }),
    ).toEqual({ state: 'open', terminalId: 'term-1', pid: 42 })
    expect(terminalMutationOutputSchema.parse({ state: 'done' })).toEqual({ state: 'done' })
  })

  it('rejects the removed wake answer', () => {
    expect(terminalMutationOutputSchema.safeParse({ state: 'waking' }).success).toBe(false)
    expect(terminalOpenOutputSchema.safeParse({ state: 'awake' }).success).toBe(false)
  })

  it('rejects a blank rename', () => {
    const ref = { sessionId: 'ses', terminalId: 'term-1' }
    expect(terminalRenameInputSchema.safeParse({ ...ref, name: '   ' }).success).toBe(false)
    expect(terminalRenameInputSchema.parse({ ...ref, name: ' build ' }).name).toBe('build')
  })

  it('round-trips every stream frame', () => {
    const frames = [
      { type: 'ready', sessionId: 'ses' },
      { type: 'parked' },
      {
        type: 'output',
        terminalId: 'term-1',
        offset: 0,
        data: Buffer.from('hi').toString('base64'),
      },
      { type: 'exit', terminalId: 'term-1', exitCode: null, signal: 'SIGTERM' },
      { type: 'closed', reason: 'restarted' },
      { type: 'gap', terminalId: 'term-1', offset: 1024 },
    ] as const
    for (const frame of frames) expect(terminalStreamFrameSchema.parse(frame)).toEqual(frame)
  })

  it('rejects negative offsets and the removed wake frame', () => {
    expect(
      terminalStreamFrameSchema.safeParse({ type: 'gap', terminalId: 'term-1', offset: -1 })
        .success,
    ).toBe(false)
    expect(
      terminalStreamFrameSchema.safeParse({ type: 'output', terminalId: 't', offset: -1, data: '' })
        .success,
    ).toBe(false)
    expect(terminalStreamFrameSchema.safeParse({ type: 'wake', state: 'waking' }).success).toBe(
      false,
    )
  })

  it('validates the attach output as the frame stream, not as one frame', () => {
    const frames = async function* () {
      yield { type: 'parked' } as const
    }
    expect(terminalStreamOutputSchema.safeParse(frames()).success).toBe(true)
    expect(terminalStreamOutputSchema.safeParse({ type: 'parked' }).success).toBe(false)
  })

  it('requires non-negative cursors on attach', () => {
    expect(
      terminalStreamAttachInputSchema.parse({
        sessionId: 'ses',
        cursors: [{ terminalId: 'term-1', offset: 0 }],
      }),
    ).toEqual({ sessionId: 'ses', cursors: [{ terminalId: 'term-1', offset: 0 }] })
    expect(
      terminalStreamAttachInputSchema.safeParse({
        sessionId: 'ses',
        cursors: [{ terminalId: 'term-1', offset: -1 }],
      }).success,
    ).toBe(false)
  })

  it('bounds the stream buffer', () => {
    expect(TERMINAL_STREAM_BUFFER_BYTES).toBe(262_144)
  })
})

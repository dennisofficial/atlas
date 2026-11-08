import { describe, expect, it } from 'bun:test'

import {
  ECallStatus,
  EShellRunStatus,
  type CallResult,
  type ShellInfo,
} from '@dltech/atlas-protocol'

import { readDelta, ShellCursors } from '../cursors'

const info: ShellInfo = {
  shellId: 'shell-a',
  command: 'x',
  pid: 1,
  startedAt: '2026-11-08T10:00:00.000Z',
  status: EShellRunStatus.Running,
  exitCode: null,
  signal: null,
  totalBytes: 0,
}

const reading = (args: { offset: number; text: string; totalBytes: number }) => ({
  call: async (): Promise<CallResult> => ({
    status: ECallStatus.Ok,
    op: 'shells.read',
    value: {
      offset: args.offset,
      bytes: Buffer.from(args.text).toString('base64'),
      totalBytes: args.totalBytes,
      info,
    },
  }),
})

describe('readDelta', () => {
  it('advances the cursor past what it decoded', async () => {
    const cursors = new ShellCursors()
    const read = await readDelta({
      ctx: reading({ offset: 0, text: 'héllo', totalBytes: 6 }),
      cursors,
      shellId: 'shell-a',
    })
    expect(read).toMatchObject({ ok: true, value: { text: 'héllo', remainingCharacters: 0 } })
    expect(cursors.get('shell-a')).toBe(6)
  })

  it('counts a gap before the chunk as dropped characters', async () => {
    const cursors = new ShellCursors()
    cursors.set('shell-a', 4)
    const read = await readDelta({
      ctx: reading({ offset: 10, text: 'tail', totalBytes: 20 }),
      cursors,
      shellId: 'shell-a',
    })
    expect(read).toMatchObject({
      ok: true,
      value: { text: 'tail', droppedCharacters: 6, remainingCharacters: 6 },
    })
    expect(cursors.get('shell-a')).toBe(14)
  })

  it('returns the daemon refusal as a reason', async () => {
    const read = await readDelta({
      ctx: {
        call: async () => ({
          status: ECallStatus.Failed,
          op: 'shells.read',
          error: { code: 'not-found', message: 'no shell' },
        }),
      } as never,
      cursors: new ShellCursors(),
      shellId: 'shell-a',
    })
    expect(read).toEqual({ ok: false, reason: 'no shell' })
  })

  it('resets a cursor', () => {
    const cursors = new ShellCursors()
    cursors.set('shell-a', 9)
    cursors.reset('shell-a')
    expect(cursors.get('shell-a')).toBe(0)
  })
})

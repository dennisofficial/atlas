import { describe, expect, it } from 'bun:test'

import { EShellStatus, type V2Event } from '@dltech/atlas-core'

import { foldShells, shellsOfEvents, type ShellsViewState } from '..'

const at = (n: number): string => `2026-11-08T10:00:0${n}.000Z`

const stamp = (body: Record<string, unknown>, n: number): V2Event =>
  ({ ...body, seq: n, at: at(n), threadId: 't1', id: `e${n}` }) as unknown as V2Event

const started = (n: number, extra: Record<string, unknown> = {}): V2Event =>
  stamp({ type: 'background-shell-started', shellId: 'shell-a', command: 'sleep 30', ...extra }, n)

const ended = (n: number, output: string, status = EShellStatus.Killed): V2Event =>
  stamp(
    {
      type: 'background-shell-ended',
      shellId: 'shell-a',
      command: 'sleep 30',
      status,
      output,
      droppedCharacters: 0,
      remainingCharacters: 0,
    },
    n,
  )

const awaiting = (n: number, output: string): V2Event =>
  stamp(
    {
      type: 'background-shell-awaiting-input',
      shellId: 'shell-a',
      command: 'sleep 30',
      output,
      droppedCharacters: 0,
      remainingCharacters: 0,
    },
    n,
  )

describe('the shells view', () => {
  it('starts a running row and fills it in when the shell ends', () => {
    const rows = shellsOfEvents([started(1, { cwd: '/work' }), ended(2, 'tick\ntick\n')])
    expect(rows).toEqual([
      {
        shellId: 'shell-a',
        name: '`sleep 30`',
        command: 'sleep 30',
        cwd: '/work',
        status: EShellStatus.Killed,
        characters: 10,
        awaitingInput: false,
        changedAt: at(2),
      },
    ])
  })

  it('names the row after its description when there is one', () => {
    const [row] = shellsOfEvents([started(1, { description: 'ticker' })])
    expect(row?.name).toBe('"ticker" (`sleep 30`)')
  })

  it('raises awaiting input and clears it on the ending', () => {
    const waiting = shellsOfEvents([started(1), awaiting(2, 'Continue? ')])
    expect(waiting[0]).toMatchObject({
      status: EShellStatus.Running,
      awaitingInput: true,
      characters: 10,
    })
    const done = foldShells(waiting, ended(3, 'ok\n', EShellStatus.Exited))
    expect(done[0]).toMatchObject({
      status: EShellStatus.Exited,
      awaitingInput: false,
      characters: 13,
    })
  })

  it('adds a row for an ending whose start it never saw', () => {
    const rows = shellsOfEvents([ended(1, 'late\n', EShellStatus.Exited)])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      shellId: 'shell-a',
      status: EShellStatus.Exited,
      characters: 5,
    })
  })

  it('keeps first-insertion order when a row is replaced', () => {
    const other = stamp({ type: 'background-shell-started', shellId: 'shell-b', command: 'ls' }, 2)
    const rows = shellsOfEvents([started(1), other, ended(3, '')])
    expect(rows.map((row) => row.shellId)).toEqual(['shell-a', 'shell-b'])
  })

  it('returns the same array for an unrelated event', () => {
    const state: ShellsViewState = shellsOfEvents([started(1)])
    expect(foldShells(state, stamp({ type: 'user-said', text: 'hi' }, 2))).toBe(state)
  })
})

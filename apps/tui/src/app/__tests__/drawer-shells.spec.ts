import { describe, expect, test } from 'bun:test'

import { EShellStatus } from '@dltech/atlas-core'
import type { ShellRow } from '@dltech/atlas-plugin-shells/core'

import { drawerShellsOf, shellFoldOf, shellOutputOf } from '../drawer-shells'

const rowOf = (patch: Partial<ShellRow>): ShellRow => ({
  shellId: 'sh-1',
  name: 'the test run',
  command: 'bun test',
  status: EShellStatus.Running,
  characters: 12,
  awaitingInput: false,
  changedAt: '2026-11-20T00:00:00.000Z',
  ...patch,
})

describe('drawerShellsOf', () => {
  test('a shell row becomes a drawer shell dated by its change', () => {
    const [shell] = drawerShellsOf({ rows: [rowOf({})], sessionId: 'session-one' })

    expect(shell?.threadId).toBe('session-one')
    expect(shell?.description).toBe('the test run')
    expect(shell?.command).toBe('bun test')
    expect(shell?.startedAt).toBe('2026-11-20T00:00:00.000Z')
    expect(shell?.lastOutputAt).toBe('2026-11-20T00:00:00.000Z')
    expect(shell?.totalCharacters).toBe(12)
  })
})

describe('shellFoldOf', () => {
  test('hides the settled shells and keeps a failed one counted', () => {
    const shells = drawerShellsOf({
      rows: [
        rowOf({ shellId: 'running' }),
        rowOf({ shellId: 'exited', status: EShellStatus.Exited }),
        rowOf({ shellId: 'killed', status: EShellStatus.Killed }),
      ],
      sessionId: 'session-one',
    })

    expect(shellFoldOf(shells)).toEqual({ hidden: 2, hiddenFailed: true })
  })

  test('a clean set of settled shells hides them without a failure', () => {
    const shells = drawerShellsOf({
      rows: [
        rowOf({ shellId: 'running' }),
        rowOf({ shellId: 'exited', status: EShellStatus.Exited }),
      ],
      sessionId: 'session-one',
    })

    expect(shellFoldOf(shells)).toEqual({ hidden: 1, hiddenFailed: false })
  })
})

describe('shellOutputOf', () => {
  test('reads the followed tail for the open shell', () => {
    expect(shellOutputOf({ tails: { 'sh-1': { text: 'printed' } }, shellId: 'sh-1' })).toBe(
      'printed',
    )
  })

  test('an unfollowed shell has printed nothing', () => {
    expect(shellOutputOf({ tails: {}, shellId: 'sh-1' })).toBe('')
  })
})

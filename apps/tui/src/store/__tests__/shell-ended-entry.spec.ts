import { describe, expect, it } from 'bun:test'

import { EKilledBy, EShellStatus, type Event } from '@dltech/atlas-core'

import { durableEntries } from '../durable-entries'
import { isExpandable } from '../expandable'
import { EEntryKind, type BackgroundShellEndedEntry } from '../transcript-model'
import { log } from './fixture'

const shellEnded = (over: Record<string, unknown> = {}) =>
  ({
    type: 'background-shell-ended' as const,
    shellId: 'bash_1',
    command: 'bun test',
    description: 'Run full TUI suite',
    status: EShellStatus.Exited,
    exitCode: 0,
    output: '261 pass, 0 fail\n',
    droppedCharacters: 0,
    remainingCharacters: 0,
    ...over,
  })

const onlyShellEntry = (events: readonly Event[]): BackgroundShellEndedEntry => {
  const entry = durableEntries({ events }).find(
    (candidate): candidate is BackgroundShellEndedEntry =>
      candidate.kind === EEntryKind.BackgroundShellEnded,
  )
  if (entry === undefined) throw new Error('no background shell entry was projected')
  return entry
}

describe('a background shell ending in the transcript', () => {
  it('is its own entry rather than something the operator said', () => {
    const entries = durableEntries({ events: log([shellEnded()]) })

    expect(entries).toHaveLength(1)
    expect(entries[0]?.kind).toBe(EEntryKind.BackgroundShellEnded)
  })

  it('reads as an event naming the job, not as the command that ran', () => {
    expect(onlyShellEntry(log([shellEnded()])).text).toBe(
      'Background shell "Run full TUI suite" completed (exit code 0)',
    )
  })

  it('falls back to the command when the shell was never named', () => {
    expect(onlyShellEntry(log([shellEnded({ description: undefined })])).text).toBe(
      'Background shell `bun test` completed (exit code 0)',
    )
  })

  it('says a kill was a kill', () => {
    const entry = onlyShellEntry(
      log([shellEnded({ status: EShellStatus.Killed, exitCode: undefined })]),
    )

    expect(entry.text).toBe('Background shell "Run full TUI suite" was killed')
    expect(entry.failed).toBe(false)
  })

  it('says the developer was the one who killed it', () => {
    const entry = onlyShellEntry(
      log([shellEnded({ status: EShellStatus.Killed, killedBy: EKilledBy.User, exitCode: undefined })]),
    )

    expect(entry.text).toBe('Background shell "Run full TUI suite" was killed by you')
  })

  it('says a rewind was what killed it', () => {
    const entry = onlyShellEntry(
      log([shellEnded({ status: EShellStatus.Killed, killedBy: EKilledBy.Rewind, exitCode: undefined })]),
    )

    expect(entry.text).toBe('Background shell "Run full TUI suite" was killed by a rewind')
  })

  it('says a shell lost to a closed session ended with it, not that atlas killed it', () => {
    const entry = onlyShellEntry(
      log([
        shellEnded({ status: EShellStatus.Killed, killedBy: EKilledBy.Unrecorded, exitCode: undefined }),
      ]),
    )

    expect(entry.text).toBe(
      'Background shell "Run full TUI suite" was killed when the previous session ended',
    )
  })

  it('says a lost shell was killed, and marks it failed', () => {
    const entry = onlyShellEntry(
      log([
        shellEnded({
          status: EShellStatus.Killed,
          killedBy: EKilledBy.LostContact,
          exitCode: undefined,
        }),
      ]),
    )

    expect(entry.text).toBe(
      'Background shell "Run full TUI suite" was killed after atlas lost contact with it',
    )
    expect(entry.failed).toBe(true)
  })

  it('says a timeout blew a deadline rather than that someone killed it', () => {
    const entry = onlyShellEntry(
      log([
        shellEnded({
          status: EShellStatus.Killed,
          killedBy: EKilledBy.Timeout,
          exitCode: undefined,
        }),
      ]),
    )

    expect(entry.text).toBe('Background shell "Run full TUI suite" ran past its timeout')
    expect(entry.text).not.toContain('killed')
  })

  it('marks a timeout as failed, because the wait expired and the work did not land', () => {
    const entry = onlyShellEntry(
      log([
        shellEnded({
          status: EShellStatus.Killed,
          killedBy: EKilledBy.Timeout,
          exitCode: undefined,
        }),
      ]),
    )

    expect(entry.failed).toBe(true)
  })

  it('marks a non-zero exit as failed, so the line can be read at a glance', () => {
    const entry = onlyShellEntry(log([shellEnded({ exitCode: 2 })]))

    expect(entry.text).toBe('Background shell "Run full TUI suite" failed (exit code 2)')
    expect(entry.failed).toBe(true)
  })

  it('keeps the output for the fold rather than putting it on the line', () => {
    const entry = onlyShellEntry(log([shellEnded()]))

    expect(entry.text).not.toContain('261 pass')
    expect(entry.output).toBe('261 pass, 0 fail\n')
    expect(isExpandable(entry)).toBe(true)
  })

  it('does not offer a fold when the shell printed nothing', () => {
    expect(isExpandable(onlyShellEntry(log([shellEnded({ output: '' })])))).toBe(false)
  })

  it('never folds into the message a human typed beside it', () => {
    const entries = durableEntries({
      events: log([
        { type: 'user-said', text: 'Again' },
        shellEnded(),
        { type: 'user-said', text: 'go on' },
      ]),
    })

    expect(entries.map((entry) => entry.kind)).toEqual([
      EEntryKind.OperatorSaid,
      EEntryKind.BackgroundShellEnded,
      EEntryKind.OperatorSaid,
    ])
  })

  it('shows only the first ending when teardown re-recorded a settled shell', () => {
    const entries = durableEntries({
      events: log([
        shellEnded({ output: 'real output\n' }),
        shellEnded({ output: '', killedBy: EKilledBy.SessionEnd }),
      ]),
    })

    const ended = entries.filter((entry) => entry.kind === EEntryKind.BackgroundShellEnded)
    expect(ended).toHaveLength(1)
    expect(ended[0]?.output).toBe('real output\n')
  })

  it('keeps two endings for the same shell id when they are different commands across a restart', () => {
    const entries = durableEntries({
      events: log([
        shellEnded({ command: 'first run', output: 'one\n' }),
        shellEnded({ command: 'second run', output: 'two\n' }),
      ]),
    })

    expect(entries.filter((entry) => entry.kind === EEntryKind.BackgroundShellEnded)).toHaveLength(2)
  })

  it('keeps a shell-kill ending that follows a clean exit, because it is not a teardown dupe', () => {
    const entries = durableEntries({
      events: log([
        shellEnded({ output: 'real output\n' }),
        shellEnded({ status: EShellStatus.Killed, killedBy: EKilledBy.Model, output: '' }),
      ]),
    })

    expect(entries.filter((entry) => entry.kind === EEntryKind.BackgroundShellEnded)).toHaveLength(2)
  })

  it('keeps a session-end kill under a recycled id when no clean ending settled it', () => {
    const entries = durableEntries({
      events: log([
        shellEnded({ killedBy: EKilledBy.SessionEnd, output: '' }),
        shellEnded({ killedBy: EKilledBy.SessionEnd, output: '' }),
      ]),
    })

    expect(entries.filter((entry) => entry.kind === EEntryKind.BackgroundShellEnded)).toHaveLength(2)
  })

  it('hides a recorded ending, which is bookkeeping rather than speech', () => {
    const entries = durableEntries({
      events: log([
        shellEnded({ output: '', killedBy: EKilledBy.Model, recorded: true }),
      ]),
    })

    expect(entries.filter((entry) => entry.kind === EEntryKind.BackgroundShellEnded)).toHaveLength(0)
  })

  it('hides a legacy teardown dupe whose kill was already delivered as a shell_kill result', () => {
    const entries = durableEntries({
      events: log([
        {
          type: 'tool-result' as const,
          callId: 'call-1' as never,
          name: 'shell_kill',
          output: { shellId: 'bash_1', command: 'bun test', status: 'killed', exitCode: 143 },
        },
        shellEnded({ output: '', killedBy: EKilledBy.Model }),
      ]),
    })

    expect(entries.filter((entry) => entry.kind === EEntryKind.BackgroundShellEnded)).toHaveLength(0)
  })

  it('keeps a model-kill ending that carried real output, because it is the telling', () => {
    const entries = durableEntries({
      events: log([
        {
          type: 'tool-result' as const,
          callId: 'call-1' as never,
          name: 'shell_kill',
          output: { shellId: 'bash_1', command: 'bun test', status: 'killed', exitCode: 143 },
        },
        shellEnded({ output: 'real output\n', killedBy: EKilledBy.Model }),
      ]),
    })

    expect(entries.filter((entry) => entry.kind === EEntryKind.BackgroundShellEnded)).toHaveLength(1)
  })

  it('keeps a silent model-kill ending when no shell_kill result names the shell', () => {
    const entries = durableEntries({
      events: log([shellEnded({ output: '', killedBy: EKilledBy.Model })]),
    })

    expect(entries.filter((entry) => entry.kind === EEntryKind.BackgroundShellEnded)).toHaveLength(1)
  })

  it('shows the ending once when a shell_kill result and its occurrence-written ending share a turn', () => {
    const entries = durableEntries({
      events: log([
        { type: 'tool-called' as const, callId: 'call-1' as never, name: 'shell_kill', input: { shellId: 'bash_1' }, ordinal: 0 },
        {
          type: 'tool-result' as const,
          callId: 'call-1' as never,
          name: 'shell_kill',
          output: {
            shellId: 'bash_1',
            command: 'bun test',
            status: 'killed',
            exitCode: 143,
            text: '42 pass\n',
            droppedCharacters: 0,
            remainingCharacters: 0,
          },
        },
        shellEnded({
          status: EShellStatus.Killed,
          killedBy: EKilledBy.Model,
          exitCode: 143,
          output: '42 pass\n',
        }),
      ]),
    })

    const ended = entries.filter((entry) => entry.kind === EEntryKind.BackgroundShellEnded)
    expect(ended).toHaveLength(1)
    expect(ended[0]?.output).toBe('42 pass\n')
    expect(ended[0]?.text).toBe('Background shell "Run full TUI suite" was killed by atlas')
  })

  it('keeps a silent ending under a recycled id whose command no kill result names', () => {
    const entries = durableEntries({
      events: log([
        {
          type: 'tool-result' as const,
          callId: 'call-1' as never,
          name: 'shell_kill',
          output: { shellId: 'bash_1', command: 'bun test', status: 'killed', exitCode: 143 },
        },
        shellEnded({ command: 'bun run dev', output: '', killedBy: EKilledBy.Model }),
      ]),
    })

    expect(entries.filter((entry) => entry.kind === EEntryKind.BackgroundShellEnded)).toHaveLength(1)
  })
})
